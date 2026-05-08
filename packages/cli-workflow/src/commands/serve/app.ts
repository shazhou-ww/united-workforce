import { Hono } from "hono";
import { cors } from "hono/cors";

import { createCasRoutes } from "./routes-cas.js";
import { createLiveRoutes } from "./routes-live.js";
import { createThreadRoutes } from "./routes-thread.js";
import { createWorkflowRoutes } from "./routes-workflow.js";

const MAX_BODY_SIZE = 1_048_576; // 1 MB

export function createApp(storageRoot: string): Hono {
  const app = new Hono();

  app.onError((_err, c) => {
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use(
    "*",
    cors({
      origin: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:7860",
        "http://127.0.0.1:7860",
      ],
    }),
  );

  app.use("*", async (c, next) => {
    if (c.req.method === "POST") {
      const contentLength = c.req.header("content-length");
      if (contentLength !== undefined && Number(contentLength) > MAX_BODY_SIZE) {
        return c.json({ error: "Payload too large" }, 413);
      }
    }
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.route("/api/workflows", createWorkflowRoutes(storageRoot));
  app.route("/api/threads", createThreadRoutes(storageRoot));
  app.route("/api/threads", createLiveRoutes(storageRoot));
  app.route("/api/cas", createCasRoutes(storageRoot));

  return app;
}
