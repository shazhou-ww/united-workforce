import type { AgentContext, ThreadContext } from "@uncaged/workflow-runtime";

/**
 * Builds a user-message string from thread context: task, previous steps, and tool hints.
 * Does NOT include a system prompt — that is passed separately via the adapter.
 */
export async function buildThreadInput(ctx: ThreadContext): Promise<string> {
  const lines: string[] = [];

  if (ctx.start.parentState !== null) {
    lines.push("## Parent Context");
    lines.push(
      "This workflow was spawned by a parent workflow. The parent's state at spawn time is available at hash: " +
        ctx.start.parentState,
    );
    lines.push(
      `Use \`uncaged-workflow cas get ${ctx.start.parentState}\` to inspect the parent's context and trace back through its steps.`,
    );
    lines.push("");
  }

  lines.push("## Task");
  lines.push(ctx.start.content);

  const { steps } = ctx;
  if (steps.length === 0) {
    return lines.join("\n");
  }

  if (steps.length === 1) {
    const s = steps[0];
    lines.push("");
    lines.push(`## Step: ${s.role}`);
    lines.push("");
    lines.push(`ContentHash: ${s.contentHash}`);
    lines.push(`Meta: ${JSON.stringify(s.meta)}`);
  } else {
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
