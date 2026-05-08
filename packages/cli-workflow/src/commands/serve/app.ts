import { Hono } from "hono";
import { cors } from "hono/cors";

import { createCasRoutes } from "./routes-cas.js";
import { createLiveRoutes } from "./routes-live.js";
import { createThreadRoutes } from "./routes-thread.js";
import { createWorkflowRoutes } from "./routes-workflow.js";

export function createApp(storageRoot: string): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.route("/api/workflows", createWorkflowRoutes(storageRoot));
  app.route("/api/threads", createThreadRoutes(storageRoot));
  app.route("/api/threads", createLiveRoutes(storageRoot));
  app.route("/api/cas", createCasRoutes(storageRoot));

  return app;
}
