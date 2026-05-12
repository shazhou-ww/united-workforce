import type { AgentContext } from "@uncaged/workflow-runtime";

/** Builds the full agent prompt: system instructions plus summarized thread history. */
export async function buildAgentPrompt(ctx: AgentContext): Promise<string> {
  const lines: string[] = [];
  lines.push(ctx.currentRole.systemPrompt);
  lines.push("");

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
