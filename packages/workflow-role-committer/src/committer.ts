import type { AgentFn, Role, ThreadContext } from "@uncaged/workflow";
import {
  createRole,
  decorateRole,
  type LlmProvider,
  onFail,
  withDryRun,
} from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

export const committerMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("committed"),
    branch: z.string(),
    commitSha: z.string(),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.string(),
    logRef: z.string().nullable(),
  }),
]);

export type CommitterMeta = z.infer<typeof committerMetaSchema>;

export type CommitterGitConfig = {
  cwd: string;
  remote: string;
  /** When non-null, prompts mention `uncaged-workflow thread <id>` for extra context. */
  threadId: string | null;
};

export const DEFAULT_COMMITTER_GIT_CONFIG: CommitterGitConfig = {
  cwd: ".",
  remote: "origin",
  threadId: null,
};

const DRY_RUN_COMMITTED_META: CommitterMeta = {
  status: "committed",
  branch: "dry-run/placeholder",
  commitSha: "0000000",
};

function resolveExtractDryRun(extractDryRun: boolean | null): boolean {
  return extractDryRun === true;
}

function summarizeThreadContext(ctx: ThreadContext): string {
  const lines: string[] = [`Initial prompt:\n${ctx.start.content}`];
  for (const step of ctx.steps) {
    const snippet = step.content.length > 800 ? `${step.content.slice(0, 800)}…` : step.content;
    lines.push(`\n### ${step.role}\n${snippet}`);
  }
  return lines.join("\n");
}

function committerSystemPrompt(ctx: ThreadContext, gitConfig: CommitterGitConfig): string {
  const threadLine =
    gitConfig.threadId !== null
      ? `Optional CLI context: run \`uncaged-workflow thread ${gitConfig.threadId}\` if available.\n`
      : "";

  return `You are the **git committer** for this workflow. Prior roles planned, implemented, and reviewed the change; your job is to perform git operations in the repository and report the outcome.

## Repository context

- Working directory (run git commands here): \`${gitConfig.cwd}\`
- Remote name for push: \`${gitConfig.remote}\`
${threadLine}
## Thread context

${summarizeThreadContext(ctx)}

## Your task

1. Inspect the working tree (e.g. \`git status\`). If there is nothing to commit, stop and explain why in your reply.
2. Create a new branch using **conventional** naming (\`feat/<slug>\`, \`fix/<slug>\`, or \`chore/<slug>\` as appropriate).
3. Stage all intended changes, commit with a **single-line conventional commit subject**, and push the branch to \`${gitConfig.remote}\` (e.g. \`git push -u ${gitConfig.remote} <branch>\`).
4. In your reply, state clearly whether the push succeeded, the **exact branch name** used, and the **full commit SHA** from \`git rev-parse HEAD\` (or explain the failure).

Structured extraction will read \`status\`, branch, commit SHA, or error details from your answer.`;
}

/**
 * Git committer role: the agent runs git (branch, commit, push); structured extraction yields {@link CommitterMeta}.
 * Dry-run skips the agent and returns a stable committed placeholder; unexpected throws yield \`status: "failed"\`.
 */
export function createCommitterRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: CommitterMeta },
  gitConfig: CommitterGitConfig = DEFAULT_COMMITTER_GIT_CONFIG,
): Role<CommitterMeta> {
  const inner: Role<CommitterMeta> = createRole({
    name: "committer",
    schema: committerMetaSchema,
    systemPrompt: async (ctx) => committerSystemPrompt(ctx, gitConfig),
    agent: adapter,
    extract,
  });

  return decorateRole(inner, [
    withDryRun<CommitterMeta>({
      label: "committer",
      meta: DRY_RUN_COMMITTED_META,
      dryRun: resolveExtractDryRun(extract.dryRun),
    }),
    onFail<CommitterMeta>({
      label: "committer",
      meta: {
        status: "failed",
        error: "committer role threw before structured result",
        logRef: null,
      },
    }),
  ]);
}
