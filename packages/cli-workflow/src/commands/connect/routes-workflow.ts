import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowDescriptor } from "@uncaged/workflow-protocol";
import {
  getRegisteredWorkflow,
  listRegisteredWorkflowNames,
  readWorkflowRegistry,
  validateWorkflowDescriptor,
} from "@uncaged/workflow-register";
import { Hono } from "hono";
import { parse as parseYaml } from "yaml";

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
    let descriptor: WorkflowDescriptor | null = null;
    try {
      const yamlPath = join(storageRoot, "bundles", `${entry.hash}.yaml`);
      const yamlText = await readFile(yamlPath, "utf8");
      const parsed: unknown = parseYaml(yamlText);
      const validated = validateWorkflowDescriptor(parsed);
      descriptor = validated.ok ? validated.value : null;
    } catch {
      descriptor = null;
    }
    return c.json({ name, ...entry, descriptor });
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
