import type { AgentContext } from "@uncaged/workflow";
import { getContentMerklePayload } from "@uncaged/workflow";

async function resolveStepText(ctx: AgentContext, contentHash: string): Promise<string> {
  const text = await getContentMerklePayload(ctx.cas, contentHash);
  if (text === null) {
    throw new Error(`buildAgentPrompt: missing CAS blob for ${contentHash}`);
  }
  return text;
}

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
    const body = await resolveStepText(ctx, s.contentHash);
    lines.push("");
    lines.push(`## Step: ${s.role}`);
    lines.push("");
    lines.push(body);
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
    const lastBody = await resolveStepText(ctx, last.contentHash);
    lines.push("");
    lines.push(`## Latest Step: ${last.role}`);
    lines.push("");
    lines.push(lastBody);
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
