import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { resolveThreadDataPath } from "../../thread-scan.js";

type PumpState = {
  contentOffset: number;
  carry: string;
};

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

function parseNewLines(text: string, state: PumpState): string[] {
  if (text.length < state.contentOffset) {
    state.contentOffset = 0;
    state.carry = "";
  }

  const chunk = text.slice(state.contentOffset);
  state.contentOffset = text.length;
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
        let text: string;
        try {
          text = await readFile(resolvedDataPath, "utf8");
        } catch {
          return false;
        }

        const lines = parseNewLines(text, dataState);
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
        let text: string;
        try {
          text = await readFile(infoPath, "utf8");
        } catch {
          return;
        }

        const lines = parseNewLines(text, infoState);
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
