import {
  getRegisteredWorkflow,
  listRegisteredWorkflowNames,
  readWorkflowRegistry,
} from "@uncaged/workflow";
import { Hono } from "hono";

export function createWorkflowRoutes(storageRoot: string): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const reg = await readWorkflowRegistry(storageRoot);
    if (!reg.ok) {
      return c.json({ error: reg.error.message }, 500);
    }
    const names = listRegisteredWorkflowNames(reg.value);
    const workflows = names.map((name) => {
      const entry = reg.value.workflows[name];
      return {
        name,
        hash: entry?.hash ?? null,
        timestamp: entry?.timestamp ?? null,
      };
    });
    return c.json({ workflows });
  });

  app.get("/:name", async (c) => {
    const reg = await readWorkflowRegistry(storageRoot);
    if (!reg.ok) {
      return c.json({ error: reg.error.message }, 500);
    }
    const name = c.req.param("name");
    const entry = getRegisteredWorkflow(reg.value, name);
    if (entry === null) {
      return c.json({ error: `workflow not found: ${name}` }, 404);
    }
    return c.json({ name, ...entry });
  });

  app.get("/:name/history", async (c) => {
    const reg = await readWorkflowRegistry(storageRoot);
    if (!reg.ok) {
      return c.json({ error: reg.error.message }, 500);
    }
    const name = c.req.param("name");
    const entry = getRegisteredWorkflow(reg.value, name);
    if (entry === null) {
      return c.json({ error: `workflow not found: ${name}` }, 404);
    }
    return c.json({ name, history: entry.history });
  });

  return app;
}
