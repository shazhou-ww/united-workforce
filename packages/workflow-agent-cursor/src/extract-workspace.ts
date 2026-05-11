import type { AgentContext, LlmProvider } from "@uncaged/workflow-protocol";
import { createLlmFn } from "@uncaged/workflow-reactor";
import type { ChatMessage } from "@uncaged/workflow-reactor";

const EXTRACT_SYSTEM = `You are a workspace-path extractor. Given a workflow agent context (task description and previous step outputs), identify the absolute filesystem path of the project workspace where code changes should be made.

Reply with ONLY the absolute path, nothing else. Example: /home/user/repos/my-project

If you cannot determine the workspace path, reply with: UNKNOWN`;

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
): Promise<string | null> {
  const llm = createLlmFn(provider);
  const messages: ChatMessage[] = [
    { role: "system", content: EXTRACT_SYSTEM },
    { role: "user", content: buildExtractionInput(ctx) },
  ];

  const result = await llm({ messages, tools: [] });
  if (!result.ok) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.value) as unknown;
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("choices" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).choices)
  ) {
    return null;
  }

  const choices = (parsed as Record<string, unknown>).choices as unknown[];
  if (choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("message" in first) ||
    typeof (first as Record<string, unknown>).message !== "object"
  ) {
    return null;
  }

  const message = (first as Record<string, unknown>).message as Record<string, unknown>;
  const content = message.content;
  if (typeof content !== "string") {
    return null;
  }

  const trimmed = content.trim();
  if (trimmed === "UNKNOWN" || !trimmed.startsWith("/")) {
    return null;
  }

  return trimmed;
}
