import type { AgentContext, ThreadContext } from "@uncaged/workflow-runtime";

/**
 * Builds a user-message string from thread context: task, previous steps, and tool hints.
 * Does NOT include a system prompt — that is passed separately via the adapter.
 *
 * Ordering: Task → Previous Steps → Parent Context → Tools
 * The "Deliverable" section lives in the system prompt (injected by createAgentAdapter).
 */
export async function buildThreadInput(ctx: ThreadContext): Promise<string> {
  const lines: string[] = [];

  // 1. Task — what to do
  lines.push("## Task");
  lines.push(ctx.start.content);

  const { steps } = ctx;

  // 2. Context — previous steps
  if (steps.length === 1) {
    const s = steps[0];
    lines.push("");
    lines.push(`## Step: ${s.role}`);
    lines.push("");
    lines.push(`ContentHash: ${s.contentHash}`);
    lines.push(`Meta: ${JSON.stringify(s.meta)}`);
  } else if (steps.length > 1) {
    lines.push("");
    lines.push("## Previous Steps");
    for (let i = 0; i < steps.length - 1; i++) {
      const s = steps[i];
      lines.push("");
      lines.push(`### Step ${i + 1}: ${s.role}`);
      lines.push(`Summary: ${JSON.stringify(s.meta)}`);
    }
    const last = steps[steps.length - 1];
    lines.push("");
    lines.push(`## Latest Step: ${last.role}`);
    lines.push("");
    lines.push(`ContentHash: ${last.contentHash}`);
    lines.push(`Meta: ${JSON.stringify(last.meta)}`);
  }

  // 3. Parent context — available when this workflow was spawned by another
  if (ctx.start.parentState !== null) {
    lines.push("");
    lines.push("## Parent Context");
    lines.push(
      "This workflow was spawned by a parent workflow. The parent's state at spawn time is available at hash: " +
        ctx.start.parentState,
    );
    lines.push(
      `Use \`uncaged-workflow cas get ${ctx.start.parentState}\` to inspect the parent's context and trace back through its steps.`,
    );
  }

  if (steps.length === 0 && ctx.start.parentState === null) {
    return lines.join("\n");
  }

  // 4. Tools — available commands
  lines.push("");
  lines.push("## Tools");
  lines.push(
    `Use \`uncaged-workflow thread ${ctx.threadId}\` to read full details of any previous step.`,
  );

  return lines.join("\n");
}

/**
 * @deprecated Use {@link buildThreadInput} instead. This wrapper prepends the system prompt
 * from `ctx.currentRole` for backward compatibility with existing agents.
 */
export async function buildAgentPrompt(ctx: AgentContext): Promise<string> {
  const threadInput = await buildThreadInput(ctx);
  return `${ctx.currentRole.systemPrompt}\n\n${threadInput}`;
}
