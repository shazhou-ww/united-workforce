import type { AgentFn, Role, ThreadContext } from "@uncaged/workflow";
import { createRole } from "@uncaged/workflow-agent-llm";
import type { LlmProvider } from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

export const reviewerMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("approved"),
  }),
  z.object({
    status: z.literal("rejected"),
    issues: z.array(z.string()).describe("blocking issues that must be fixed"),
  }),
]);
export type ReviewerMeta = z.infer<typeof reviewerMetaSchema>;

export type ReviewerConfig = {
  cwd: string;
};

export const DEFAULT_REVIEWER_CONFIG: ReviewerConfig = {
  cwd: ".",
};

function reviewerPrompt(config: ReviewerConfig, ctx: ThreadContext): string {
  const { cwd } = config;

  return `You are a code reviewer. The project is at \`${cwd}\`.

## Context

Use \`uncaged-workflow thread ${ctx.threadId}\` to read the full workflow thread for context on what was done and why.

## Task

Review the current git diff in \`${cwd}\`. Give a clear **approve** or **reject** verdict.

Only reject for **blocking issues** — things that must be fixed before merge. Do not mention minor style preferences or non-blocking suggestions; they will be ignored.

End with your verdict:
\`\`\`json
{ "status": "approved" }
\`\`\`
or
\`\`\`json
{ "status": "rejected", "issues": ["issue 1", "issue 2"] }
\`\`\``;
}

/**
 * Code review role: agent inspects git diffs; structured extract yields approve/reject verdict.
 */
export function createReviewerRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: ReviewerMeta },
  config: ReviewerConfig = DEFAULT_REVIEWER_CONFIG,
): Role<ReviewerMeta> {
  return createRole({
    name: "reviewer",
    schema: reviewerMetaSchema,
    systemPrompt: async (ctx) => reviewerPrompt(config, ctx),
    agent: adapter,
    extract: {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: extract.dryRunMeta,
    },
  });
}
