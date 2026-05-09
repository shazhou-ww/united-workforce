import { createCasStore } from "@uncaged/workflow-cas";
import { garbageCollectCas } from "@uncaged/workflow-execute";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { Hono } from "hono";

export function createCasRoutes(storageRoot: string): Hono {
  const app = new Hono();
  const casDir = getGlobalCasDir(storageRoot);
  const cas = createCasStore(casDir);

  app.get("/", async (c) => {
    const hashes = await cas.list();
    return c.json({ hashes });
  });

  app.get("/:hash", async (c) => {
    const content = await cas.get(c.req.param("hash"));
    if (content === null) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ hash: c.req.param("hash"), content });
  });

  app.post("/", async (c) => {
    let body: { content: string };
    try {
      body = (await c.req.json()) as { content: string };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body.content !== "string") {
      return c.json({ error: "content field required" }, 400);
    }
    const hash = await cas.put(body.content);
    return c.json({ hash }, 201);
  });

  app.delete("/:hash", async (c) => {
    const hash = c.req.param("hash");
    const content = await cas.get(hash);
    if (content === null) {
      return c.json({ error: "not found" }, 404);
    }
    await cas.delete(hash);
    return c.json({ ok: true });
  });

  app.post("/gc", async (c) => {
    const result = await garbageCollectCas(storageRoot);
    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }
    return c.json(result.value);
  });

  return app;
}
