import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type { ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import type { LogFn } from "@uncaged/workflow-util";
import * as z from "zod/v4";

const workspaceSchema = z.object({
  workspace: z.string().describe("Absolute filesystem path of the project workspace"),
});

function buildExtractionInput(ctx: ThreadContext): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(ctx.start.content);

  for (const step of ctx.steps) {
    lines.push("");
    lines.push(`## Step: ${step.role}`);
    lines.push(`Meta: ${JSON.stringify(step.meta)}`);
  }

  lines.push("");
  lines.push(
    "Extract the absolute filesystem path of the project workspace where code changes should be made.",
  );

  return lines.join("\n");
}

export async function extractWorkspacePath(
  ctx: ThreadContext,
  runtime: WorkflowRuntime,
  logger: LogFn,
): Promise<string | null> {
  const input = buildExtractionInput(ctx);
  const contentHash = await putContentNodeWithRefs(runtime.cas, input, []);

  const result = await runtime.extract(workspaceSchema, contentHash);
  const workspace = result.meta.workspace.trim();

  if (!workspace.startsWith("/")) {
    logger("H4PM7RXV", `workspace extraction returned non-absolute path: ${workspace}`);
    return null;
  }

  logger("V3KM8QWP", `extracted workspace: ${workspace}`);
  return workspace;
}
