import { Elysia, t } from "elysia";
import type { WorkFlowSteps } from "../shared/types.ts";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  saveWorkflow,
} from "./workflow.ts";

export function createApi() {
  return new Elysia({ prefix: "/api" })
    .get("/health", () => ({ status: "ok" }))
    .get("/workflows", () => listWorkflows())
    .get("/workflows/:name", async ({ params }) => {
      try {
        const steps = await getWorkflow(params.name);
        return steps;
      } catch {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    })
    .post(
      "/workflows",
      async ({ body }) => {
        await createWorkflow(body.name, body.description);
        return { ok: true };
      },
      {
        body: t.Object({
          name: t.String(),
          description: t.String(),
        }),
      },
    )
    .put(
      "/workflows/:name",
      async ({ params, body }) => {
        const steps: WorkFlowSteps = typeof body === "string" ? JSON.parse(body) : body;
        await saveWorkflow(params.name, steps);
        return { ok: true };
      },
      {
        body: t.Array(
          t.Object({
            role: t.Object({
              name: t.String(),
              description: t.String(),
              identity: t.String(),
              prepare: t.String(),
              execute: t.String(),
              report: t.String(),
            }),
            transitions: t.Array(
              t.Object({
                target: t.String(),
                status: t.String(),
              }),
            ),
          }),
        ),
      },
    )
    .delete("/workflows/:name", async ({ params }) => {
      try {
        await deleteWorkflow(params.name);
        return { ok: true };
      } catch {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    });
}
