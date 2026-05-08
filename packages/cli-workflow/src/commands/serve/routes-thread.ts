import { Hono } from "hono";

import { readTextFileIfExists } from "../../fs-utils.js";
import {
  listHistoricalThreads,
  listRunningThreads,
  resolveThreadDataPath,
} from "../../thread-scan.js";

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

  return app;
}
