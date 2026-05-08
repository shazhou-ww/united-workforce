import { statSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { resolveThreadDataPath } from "../../thread-scan.js";

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
    // File was truncated — reset
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

function isWorkflowResult(record: unknown): boolean {
  return (
    record !== null &&
    typeof record === "object" &&
    "type" in (record as Record<string, unknown>) &&
    (record as Record<string, unknown>).type === "workflow-result"
  );
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

export function createLiveRoutes(storageRoot: string): Hono {
  const app = new Hono();

  app.get("/:threadId/live", async (c) => {
    const threadId = c.req.param("threadId");
    const dataPath = await resolveThreadDataPath(storageRoot, threadId);
    if (dataPath === null) {
      return c.json({ error: `thread not found: ${threadId}` }, 404);
    }
    const resolvedDataPath = dataPath;

    const infoPath = join(dirname(resolvedDataPath), `${threadId}.info.jsonl`);

    return streamSSE(c, async (stream) => {
      const dataState: PumpState = { contentOffset: 0, carry: "" };
      const infoState: PumpState = { contentOffset: 0, carry: "" };
      let eventId = 0;

      async function pumpData(): Promise<boolean> {
        let chunk: string | null;
        try {
          chunk = await readNewBytes(resolvedDataPath, dataState);
        } catch {
          return false;
        }
        if (chunk === null) {
          return false;
        }

        const lines = parseNewLines(chunk, dataState);
        for (const line of lines) {
          const record = parseJsonLine(line);
          eventId++;
          await stream.writeSSE({
            event: "record",
            data: JSON.stringify(record),
            id: String(eventId),
          });

          if (isWorkflowResult(record)) {
            return true;
          }
        }
        return false;
      }

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
          eventId++;
          await stream.writeSSE({
            event: "info",
            data: JSON.stringify(record),
            id: String(eventId),
          });
        }
      }

      // Initial pump
      const done = await pumpData();
      await pumpInfo();
      if (done) {
        return;
      }

      // Watch for changes
      const controller = new AbortController();
      let completed = false;

      const dataWatcher = watch(resolvedDataPath, async () => {
        if (completed) return;
        const finished = await pumpData();
        if (finished) {
          completed = true;
          controller.abort();
        }
      });

      let infoWatcher: ReturnType<typeof watch> | null = null;
      try {
        infoWatcher = watch(infoPath, async () => {
          if (completed) return;
          await pumpInfo();
        });
      } catch {
        // info file may not exist
      }

      stream.onAbort(() => {
        completed = true;
        dataWatcher.close();
        infoWatcher?.close();
      });

      // Keep stream alive until completion or client disconnect
      await new Promise<void>((resolve) => {
        if (completed) {
          resolve();
          return;
        }
        controller.signal.addEventListener("abort", () => resolve(), { once: true });
        stream.onAbort(() => resolve());
      });

      dataWatcher.close();
      infoWatcher?.close();
    });
  });

  return app;
}
