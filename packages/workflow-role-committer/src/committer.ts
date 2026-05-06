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
    status: z.literal("recoverable"),
    error: z.string(),
    logRef: z.string().nullable(),
  }),
  z.object({
    status: z.literal("unrecoverable"),
    error: z.string(),
    logRef: z.string().nullable(),
  }),
]);

export type CommitterMeta = z.infer<typeof committerMetaSchema>;

export type CommitterConfig = {
  cwd: string;
};

export const DEFAULT_COMMITTER_CONFIG: CommitterConfig = {
  cwd: ".",
};

const DRY_RUN_COMMITTED_META: CommitterMeta = {
  status: "committed",
  branch: "dry-run/placeholder",
  commitSha: "0000000",
};

function resolveExtractDryRun(extractDryRun: boolean | null): boolean {
  return extractDryRun === true;
}

function committerSystemPrompt(ctx: ThreadContext, config: CommitterConfig): string {
  return `You are the git committer for this workflow. The project is at \`${config.cwd}\`.

## Context

Use \`uncaged-workflow thread ${ctx.threadId}\` to read the full workflow thread for context on what was done and why.

## Task

Create a branch, commit the changes, and push. Report whether the push succeeded or failed, the branch name, and the commit SHA.

## On failure

If any git operation fails, **do not attempt to fix it yourself**. Capture the key error output and classify it:

- **Recoverable**: failures that a coder can fix (lint/test hook rejection, merge conflict, commit validation errors)
- **Unrecoverable**: failures beyond code changes (no push permission, remote not found, authentication denied, disk full)`;
}

/**
 * Git committer role: the agent runs git (branch, commit, push); structured extraction yields {@link CommitterMeta}.
 * Dry-run skips the agent and returns a stable committed placeholder; unexpected throws yield `status: "failed"`.
 */
export function createCommitterRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: CommitterMeta },
  config: CommitterConfig = DEFAULT_COMMITTER_CONFIG,
): Role<CommitterMeta> {
  const inner: Role<CommitterMeta> = createRole({
    name: "committer",
    schema: committerMetaSchema,
    systemPrompt: async (ctx) => committerSystemPrompt(ctx, config),
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
        status: "unrecoverable",
        error: "committer role threw before structured result",
        logRef: null,
      },
    }),
  ]);
}
