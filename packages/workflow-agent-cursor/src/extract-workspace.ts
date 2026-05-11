import type { AgentContext, LlmProvider } from "@uncaged/workflow-protocol";
import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
import type { LogFn } from "@uncaged/workflow-util";
import * as z from "zod/v4";

const workspaceSchema = z.object({
  workspace: z.string().describe("Absolute filesystem path of the project workspace"),
});

const EXTRACT_SYSTEM_FN = (_toolName: string) =>
  `You are a workspace-path extractor. Given a workflow agent context (task description and previous step outputs), identify the absolute filesystem path of the project workspace where code changes should be made. Call the tool with the absolute path.`;

function buildExtractionInput(ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(ctx.start.content);

  for (const step of ctx.steps) {
    lines.push("");
    lines.push(`## Step: ${step.role}`);
    lines.push(`Meta: ${JSON.stringify(step.meta)}`);
  }

  return lines.join("\n");
}

export async function extractWorkspacePath(
  ctx: AgentContext,
  provider: LlmProvider,
  logger: LogFn,
): Promise<string | null> {
  const reactor = createThreadReactor<null>({
    llm: createLlmFn(provider),
    maxRounds: 2,
    staticTools: [],
    structuredToolFromSchema: (schema) => {
      const jsonSchema = z.toJSONSchema(schema);
      return {
        name: "set_workspace",
        tool: {
          type: "function" as const,
          function: {
            name: "set_workspace",
            description: "Set the extracted workspace path",
            parameters: jsonSchema as Record<string, unknown>,
          },
        },
      };
    },
    systemPromptForStructuredTool: EXTRACT_SYSTEM_FN,
    toolHandler: async () => "unknown tool",
  });

  const result = await reactor({
    thread: null,
    input: buildExtractionInput(ctx),
    schema: workspaceSchema,
  });

  if (!result.ok) {
    logger("V3KM8QWP", `workspace extraction failed: ${result.error}`);
    return null;
  }

  const workspace = result.value.workspace.trim();
  if (!workspace.startsWith("/")) {
    logger("V3KM8QWP", `workspace extraction returned non-absolute path: ${workspace}`);
    return null;
  }

  logger("V3KM8QWP", `extracted workspace: ${workspace}`);
  return workspace;
}
