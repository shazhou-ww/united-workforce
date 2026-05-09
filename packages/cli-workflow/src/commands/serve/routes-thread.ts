import { createCasStore } from "@uncaged/workflow-cas";
import { FORK_BRANCH_ROLE, walkStateFramesNewestFirst } from "@uncaged/workflow-execute";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { Hono } from "hono";

import {
  listHistoricalThreads,
  listRunningThreads,
  resolveThreadRecord,
} from "../../thread-scan.js";
import { cmdKill, cmdPause, cmdResume } from "../thread/control.js";
import { cmdRun } from "../thread/run.js";

export function createThreadRoutes(storageRoot: string): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const nameFilter = c.req.query("workflow") ?? null;
    const rows = await listHistoricalThreads(storageRoot, nameFilter);
    return c.json({ threads: rows });
  });

  app.get("/running", async (c) => {
    const rows = await listRunningThreads(storageRoot);
    return c.json({ threads: rows });
  });

  app.get("/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    const resolved = await resolveThreadRecord(storageRoot, threadId);
    if (resolved === null) {
      return c.json({ error: `thread not found: ${threadId}` }, 404);
    }

    const cas = createCasStore(getGlobalCasDir(storageRoot));
    const frames = await walkStateFramesNewestFirst(cas, resolved.head);
    const chronological = [...frames].reverse();

    const records: unknown[] = [
      {
        type: "thread-start",
        threadId: resolved.threadId,
        bundleHash: resolved.bundleHash,
        head: resolved.head,
        start: resolved.start,
        source: resolved.source,
      },
    ];

    for (const fr of chronological) {
      if (fr.payload.role === FORK_BRANCH_ROLE) {
        continue;
      }
      if (fr.payload.role === END) {
        const returnCode = fr.payload.meta.returnCode;
        const summary = fr.payload.meta.summary;
        if (typeof returnCode === "number" && typeof summary === "string") {
          records.push({ type: "workflow-result", returnCode, summary });
        }
        continue;
      }
      records.push({
        role: fr.payload.role,
        contentHash: fr.payload.content,
        meta: fr.payload.meta,
        timestamp: fr.payload.timestamp,
      });
    }

    return c.json({ threadId, records });
  });

  app.post("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const name = body.workflow;
    const prompt = body.prompt;
    const maxRounds = typeof body.maxRounds === "number" ? body.maxRounds : 10;

    if (typeof name !== "string" || typeof prompt !== "string") {
      return c.json({ error: "workflow (string) and prompt (string) are required" }, 400);
    }

    const result = await cmdRun(storageRoot, name, prompt, maxRounds);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ threadId: result.value.threadId }, 201);
  });

  app.post("/:threadId/kill", async (c) => {
    const threadId = c.req.param("threadId");
    const result = await cmdKill(storageRoot, threadId);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  app.post("/:threadId/pause", async (c) => {
    const threadId = c.req.param("threadId");
    const result = await cmdPause(storageRoot, threadId);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  app.post("/:threadId/resume", async (c) => {
    const threadId = c.req.param("threadId");
    const result = await cmdResume(storageRoot, threadId);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  return app;
}
