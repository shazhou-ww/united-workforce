import { Hono } from "hono";

import { readTextFileIfExists } from "../../fs-utils.js";
import {
  listHistoricalThreads,
  listRunningThreads,
  resolveThreadDataPath,
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
    const dataPath = await resolveThreadDataPath(storageRoot, threadId);
    if (dataPath === null) {
      return c.json({ error: `thread not found: ${threadId}` }, 404);
    }
    const text = await readTextFileIfExists(dataPath);
    if (text === null) {
      return c.json({ error: `thread data missing: ${threadId}` }, 404);
    }
    const lines = text.trim().split("\n");
    const records = lines.map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { raw: line };
      }
    });
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
