import type { ThreadContext } from "@uncaged/workflow";

/** Builds the full agent prompt: system instructions plus summarized thread history. */
export function buildAgentPrompt(systemPrompt: string, ctx: ThreadContext): string {
  const lines: string[] = [];
  lines.push(systemPrompt);
  lines.push("");
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
    lines.push(s.content);
    lines.push("");
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
    lines.push(last.content);
    lines.push("");
    lines.push(`Meta: ${JSON.stringify(last.meta)}`);
  }

  lines.push("");
  lines.push("## Tools");
  lines.push(
    `Use \`uncaged-workflow thread ${ctx.threadId}\` to read full details of any previous step.`,
  );

  return lines.join("\n");
}
