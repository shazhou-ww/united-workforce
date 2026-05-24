import type { AgentContext } from "@uncaged/workflow-runtime";

/** Max characters of step content to include in the prompt. */
const CONTENT_QUOTA = 16_000;

/** Builds the full agent prompt: system instructions plus summarized thread history. */
export async function buildAgentPrompt(ctx: AgentContext): Promise<string> {
  const lines: string[] = [];
  lines.push(ctx.currentRole.systemPrompt);
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
    lines.push(`Meta: ${JSON.stringify(s.meta)}`);
    appendContent(lines, s.content);
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
    lines.push(`Meta: ${JSON.stringify(last.meta)}`);
    appendContent(lines, last.content);
  }

  lines.push("");
  lines.push("## Tools");
  lines.push(
    `Use \`uncaged-workflow thread ${ctx.threadId}\` to read full details of any previous step.`,
  );

  return lines.join("\n");
}

function appendContent(lines: string[], content: string | null | undefined): void {
  if (content === null || content === undefined || content.trim() === "") {
    return;
  }
  const truncated =
    content.length > CONTENT_QUOTA
      ? `${content.slice(0, CONTENT_QUOTA)}\n... (truncated)`
      : content;
  lines.push("");
  lines.push("<output>");
  lines.push(truncated);
  lines.push("</output>");
}
