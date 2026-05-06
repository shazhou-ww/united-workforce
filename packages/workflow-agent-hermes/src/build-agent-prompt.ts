import type { ThreadContext } from "@uncaged/workflow";

/** Combines the role system prompt with thread start content and prior role outputs. */
export function buildAgentPrompt(ctx: ThreadContext, systemPrompt: string): string {
  const blocks: string[] = [];
  blocks.push("# System instructions");
  blocks.push(systemPrompt);
  blocks.push("");
  blocks.push("# Thread");
  blocks.push("## Start");
  blocks.push(ctx.start.content);
  for (const step of ctx.steps) {
    blocks.push(`## Role: ${step.role}`);
    blocks.push(step.content);
  }
  return blocks.join("\n");
}
