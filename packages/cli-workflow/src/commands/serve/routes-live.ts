import { statSync, watch } from "node:fs";
import { join } from "node:path";
import { createCasStore, getContentMerklePayload } from "@uncaged/workflow-cas";
import {
  FORK_BRANCH_ROLE,
  readThreadsIndex,
  type ThreadIndex,
  walkStateFramesNewestFirst,
} from "@uncaged/workflow-execute";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { resolveThreadRecord } from "../../thread-scan.js";

type PumpState = {
  contentOffset: number;
  carry: string;
};

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function readNewBytes(path: string, state: PumpState): Promise<string | null> {
  const size = fileSize(path);
  if (size < state.contentOffset) {
    state.contentOffset = 0;
    state.carry = "";
  }
  if (size <= state.contentOffset) {
    return null;
  }
  const blob = Bun.file(path).slice(state.contentOffset, size);
  const chunk = await blob.text();
  state.contentOffset = size;
  return chunk;
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return { raw: line };
  }
}

function parseNewLines(chunk: string, state: PumpState): string[] {
  state.carry += chunk;

  const parts = state.carry.split("\n");
  state.carry = parts.pop() ?? "";

  const lines: string[] = [];
  for (const line of parts) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      lines.push(trimmed);
    }
  }
  return lines;
}

type CasSseState = {
  printedHashes: Set<string>;
  lastHead: string | null;
  completionEmitted: boolean;
};

type LiveSseStream = {
  writeSSE: (opts: { event: string; data: string; id: string }) => Promise<void>;
};

function completionFromEndMeta(meta: Record<string, unknown>): {
  returnCode: number;
  summary: string;
} | null {
  const returnCode = meta.returnCode;
  const summary = meta.summary;
  if (typeof returnCode !== "number" || typeof summary !== "string") {
    return null;
  }
  return { returnCode, summary };
}

async function emitRecordsForHead(params: {
  storageRoot: string;
  bundleDir: string;
  threadId: string;
  headHash: string;
  sseState: CasSseState;
  stream: LiveSseStream;
  eventId: { n: number };
}): Promise<boolean> {
  const cas = createCasStore(getGlobalCasDir(params.storageRoot));
  const frames = await walkStateFramesNewestFirst(cas, params.headHash);
  const chronological = [...frames].reverse();

  for (const fr of chronological) {
    if (params.sseState.printedHashes.has(fr.hash)) {
      continue;
    }
    params.sseState.printedHashes.add(fr.hash);

    const role = fr.payload.role;
    if (role === FORK_BRANCH_ROLE) {
      continue;
    }

    if (role === END) {
      const wf = completionFromEndMeta(fr.payload.meta);
      if (wf !== null) {
        params.eventId.n++;
        await params.stream.writeSSE({
          event: "record",
          data: JSON.stringify({ type: "workflow-result", ...wf }),
          id: String(params.eventId.n),
        });
        return true;
      }
      continue;
    }

    const payloadText = await getContentMerklePayload(cas, fr.payload.content);
    const content =
      payloadText !== null
        ? payloadText
        : `(content not in CAS; contentHash=${fr.payload.content})`;

    params.eventId.n++;
    await params.stream.writeSSE({
      event: "record",
      data: JSON.stringify({
        type: "role",
        role: fr.payload.role,
        contentHash: fr.payload.content,
        content,
        meta: fr.payload.meta,
        timestamp: fr.payload.timestamp,
      }),
      id: String(params.eventId.n),
    });
  }

  return false;
}

async function pumpThreadsJsonSse(params: {
  storageRoot: string;
  bundleDir: string;
  threadId: string;
  sseState: CasSseState;
  stream: LiveSseStream;
  eventId: { n: number };
}): Promise<boolean> {
  let idx: ThreadIndex;
  try {
    idx = await readThreadsIndex(params.bundleDir);
  } catch {
    idx = {};
  }

  const active = idx[params.threadId];

  if (active === undefined) {
    if (params.sseState.completionEmitted) {
      return false;
    }
    const hist = await resolveThreadRecord(params.storageRoot, params.threadId);
    if (hist === null || hist.source !== "history") {
      return false;
    }
    params.sseState.completionEmitted = true;
    return await emitRecordsForHead({
      storageRoot: params.storageRoot,
      bundleDir: params.bundleDir,
      threadId: params.threadId,
      headHash: hist.head,
      sseState: params.sseState,
      stream: params.stream,
      eventId: params.eventId,
    });
  }

  const head = active.head;
  if (params.sseState.lastHead === null) {
    params.sseState.lastHead = head;
    return await emitRecordsForHead({
      storageRoot: params.storageRoot,
      bundleDir: params.bundleDir,
      threadId: params.threadId,
      headHash: head,
      sseState: params.sseState,
      stream: params.stream,
      eventId: params.eventId,
    });
  }

  if (head !== params.sseState.lastHead) {
    params.sseState.lastHead = head;
    return await emitRecordsForHead({
      storageRoot: params.storageRoot,
      bundleDir: params.bundleDir,
      threadId: params.threadId,
      headHash: head,
      sseState: params.sseState,
      stream: params.stream,
      eventId: params.eventId,
    });
  }

  return false;
}

export function createLiveRoutes(storageRoot: string): Hono {
  const app = new Hono();

  app.get("/:threadId/live", async (c) => {
    const threadId = c.req.param("threadId");
    const resolved = await resolveThreadRecord(storageRoot, threadId);
    if (resolved === null) {
      return c.json({ error: `thread not found: ${threadId}` }, 404);
    }

    const threadTarget = resolved;
    const threadsJsonPath = join(threadTarget.bundleDir, "threads.json");
    const infoPath = join(storageRoot, "logs", threadTarget.bundleHash, `${threadId}.info.jsonl`);

    return streamSSE(c, async (stream) => {
      const infoState: PumpState = { contentOffset: 0, carry: "" };
      const sseThreadState: CasSseState = {
        printedHashes: new Set<string>(),
        lastHead: null,
        completionEmitted: false,
      };
      const eventId = { n: 0 };

      async function pumpData(): Promise<boolean> {
        const finished = await pumpThreadsJsonSse({
          storageRoot,
          bundleDir: threadTarget.bundleDir,
          threadId,
          sseState: sseThreadState,
          stream,
          eventId,
        });
        return finished;
      }

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE newline framing mirrors legacy pump
      async function pumpInfo(): Promise<void> {
        let chunk: string | null;
        try {
          chunk = await readNewBytes(infoPath, infoState);
        } catch {
          return;
        }
        if (chunk === null) {
          return;
        }

        const lines = parseNewLines(chunk, infoState);
        for (const line of lines) {
          const record = parseJsonLine(line);
          if (
            typeof record === "object" &&
            record !== null &&
            "raw" in (record as Record<string, unknown>)
          ) {
            continue;
          }
          eventId.n++;
          await stream.writeSSE({
            event: "info",
            data: JSON.stringify(record),
            id: String(eventId.n),
          });
        }
      }

      eventId.n++;
      await stream.writeSSE({
        event: "record",
        data: JSON.stringify({
          type: "thread-start",
          threadId: threadTarget.threadId,
          bundleHash: threadTarget.bundleHash,
          head: threadTarget.head,
          start: threadTarget.start,
          source: threadTarget.source,
        }),
        id: String(eventId.n),
      });

      const done = await pumpData();
      try {
        await pumpInfo();
      } catch {
        // optional info file
      }
      if (done) {
        return;
      }

      const controller = new AbortController();
      let completed = false;

      const threadsJsonWatcher = watch(threadsJsonPath, async () => {
        if (completed) {
          return;
        }
        const finished = await pumpData();
        if (finished) {
          completed = true;
          controller.abort();
        }
      });

      let infoWatcher: ReturnType<typeof watch> | null = null;
      try {
        infoWatcher = watch(infoPath, async () => {
          if (completed) {
            return;
          }
          await pumpInfo();
        });
      } catch {
        // info file may not exist
      }

      stream.onAbort(() => {
        completed = true;
        threadsJsonWatcher.close();
        infoWatcher?.close();
      });

      await new Promise<void>((resolve) => {
        if (completed) {
          resolve();
          return;
        }
        controller.signal.addEventListener("abort", () => resolve(), { once: true });
        stream.onAbort(() => resolve());
      });

      threadsJsonWatcher.close();
      infoWatcher?.close();
    });
  });

  return app;
}
