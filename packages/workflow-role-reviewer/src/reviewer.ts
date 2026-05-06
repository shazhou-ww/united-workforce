import type { AgentFn, Role, ThreadContext } from "@uncaged/workflow";
import { createRole, type LlmProvider } from "@uncaged/workflow-role-llm";
import * as z from "zod/v4";

export const reviewerMetaSchema = z.object({
  approved: z.boolean().describe("true if the diff is clean and ready to merge"),
});
export type ReviewerMeta = z.infer<typeof reviewerMetaSchema>;

export type ReviewerConfig = {
  cwd: string;
  conventionsPath: string | null;
  extraChecks: ReadonlyArray<string>;
  /** When non-null, prompts reference `uncaged-workflow thread <id>`. */
  threadId: string | null;
};

export const DEFAULT_REVIEWER_CONFIG: ReviewerConfig = {
  cwd: ".",
  conventionsPath: "CONVENTIONS.md",
  extraChecks: [],
  threadId: null,
};

function summarizeThreadContext(ctx: ThreadContext): string {
  const lines: string[] = [`Initial prompt:\n${ctx.start.content}`];
  for (const step of ctx.steps) {
    const snippet = step.content.length > 600 ? `${step.content.slice(0, 600)}…` : step.content;
    lines.push(`\n### ${step.role}\n${snippet}`);
  }
  return lines.join("\n");
}

function reviewerPrompt(config: ReviewerConfig, ctx: ThreadContext): string {
  const { cwd, conventionsPath, extraChecks, threadId } = config;

  const conventionsBlock =
    conventionsPath !== null ? `Read project conventions: \`cat ${cwd}/${conventionsPath}\`\n` : "";

  const threadBlock =
    threadId !== null
      ? `Read the workflow thread for context: \`uncaged-workflow thread ${threadId}\`\n`
      : `## Thread context (no thread id)\n\n${summarizeThreadContext(ctx)}\n`;

  const extraBlock =
    extraChecks.length > 0
      ? `\n### Project-specific checks\n${extraChecks.map((c) => `- ${c}`).join("\n")}\n`
      : "";

  return `You are a **code reviewer**. You run after the coder and before the tester.

**IMPORTANT: The project is at \`${cwd}\`. Always \`cd ${cwd}\` first.**

${threadBlock}
${conventionsBlock}
## Your job — static analysis of the git diff

Run these commands and analyze the output:

1. **\`cd ${cwd} && git diff --stat\`** — see what files changed
2. **\`cd ${cwd} && git diff\`** — read the actual diff
3. **\`cd ${cwd} && git status --short\`** — check for untracked files

## Checklist

### Reject (approved: false) — tell coder exactly what to fix
- **Garbage files**: build artifacts, lockfiles, IDE config that should not be committed
- **Secrets/credentials**: API keys, tokens, passwords hardcoded in the diff
- **Unrelated changes**: files modified outside the scope of the task
${
  conventionsPath !== null
    ? `- **Convention violations**: patterns that contradict ${conventionsPath}\n`
    : ""
}${extraBlock}
### Approve (approved: true) — no comment needed
- Diff is clean, focused, follows project standards

End with:
\`\`\`json
{ "approved": true }
\`\`\`
or
\`\`\`json
{ "approved": false }
\`\`\``;
}

/**
 * Code review role: agent inspects git diffs; structured extract yields `approved`.
 */
export function createReviewerRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null },
  config: ReviewerConfig = DEFAULT_REVIEWER_CONFIG,
): Role<ReviewerMeta> {
  return createRole({
    name: "reviewer",
    schema: reviewerMetaSchema,
    systemPrompt: async (ctx) => reviewerPrompt(config, ctx),
    agent: adapter,
    extract: { provider: extract.provider, dryRun: extract.dryRun },
  });
}
