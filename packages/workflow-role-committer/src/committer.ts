import type { AgentFn, Role, RoleResult, ThreadContext } from "@uncaged/workflow";
import type { LlmProvider } from "@uncaged/workflow-role-llm";
import { extractMetaOrThrow } from "@uncaged/workflow-role-llm";
import { decorateRole, onFail, withDryRun } from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

import { gitExec } from "./git-exec.js";

export const committerMetaSchema = z.object({
  committed: z
    .boolean()
    .describe("true if branch created, changes committed, and pushed successfully"),
});
export type CommitterMeta = z.infer<typeof committerMetaSchema>;

const committerPlanSchema = z.object({
  branch: z.string().describe("Feature branch name, e.g. feat/slug or fix/slug"),
  message: z.string().describe("Single-line conventional commit subject"),
});

export type CommitterPlanMeta = z.infer<typeof committerPlanSchema>;

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

function sanitizeBranch(branch: string): string {
  const t = branch.trim();
  if (
    t === "" ||
    t.includes("..") ||
    t.includes(" ") ||
    t.startsWith("-") ||
    t.includes("\n") ||
    t.includes("\t")
  ) {
    throw new Error(`invalid branch name: ${branch}`);
  }
  return t;
}

function sanitizeCommitMessage(message: string): string {
  const line = message.trim().split(/\r?\n/)[0] ?? "";
  if (line === "") {
    throw new Error("commit message is empty");
  }
  return line;
}

function committerPlanPrompt(ctx: ThreadContext, gitConfig: CommitterGitConfig): string {
  const threadLine =
    gitConfig.threadId !== null
      ? `Optional CLI context: run \`uncaged-workflow thread ${gitConfig.threadId}\` if available.\n`
      : "";

  return `You plan a git branch and a single-line conventional commit message for the following workflow thread.

${threadLine}
## Thread context

${summarizeThreadContext(ctx)}

## Your task

Infer a good branch name (\`feat/<slug>\` or \`fix/<slug>\`) and a conventional commit **subject** (one line, no body).

Reply with enough detail that a maintainer understands the change; structured extraction will read \`branch\` and \`message\` from your answer.`;
}

async function runCommitterPipeline(
  ctx: ThreadContext,
  agent: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: CommitterPlanMeta },
  gitConfig: CommitterGitConfig,
): Promise<RoleResult<CommitterMeta>> {
  const cwd = gitConfig.cwd;
  const porcelain = await gitExec(cwd, ["status", "--porcelain"]);
  if (porcelain.trim() === "") {
    return {
      content: "Working tree clean; nothing to commit.",
      meta: { committed: false },
    };
  }

  const prompt = committerPlanPrompt(ctx, gitConfig);
  const raw = await agent(ctx, prompt);
  const plan = await extractMetaOrThrow("committer-plan", raw, committerPlanSchema, {
    provider: extract.provider,
    dryRun: resolveExtractDryRun(extract.dryRun),
    dryRunMeta: extract.dryRunMeta,
  });

  const branch = sanitizeBranch(plan.branch);
  const message = sanitizeCommitMessage(plan.message);

  await gitExec(cwd, ["checkout", "-b", branch]);
  await gitExec(cwd, ["add", "-A"]);
  await gitExec(cwd, ["commit", "-m", message]);
  await gitExec(cwd, ["push", "-u", gitConfig.remote, branch]);

  return {
    content: raw,
    meta: { committed: true },
  };
}

/**
 * Git committer role: LLM proposes branch + message; this package runs git via `child_process`.
 * Decorators match nerve semantics: dry-run skips work with `committed: true`; failures yield `committed: false`.
 */
export function createCommitterRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: CommitterPlanMeta },
  gitConfig: CommitterGitConfig = DEFAULT_COMMITTER_GIT_CONFIG,
): Role<CommitterMeta> {
  const inner: Role<CommitterMeta> = async (ctx) =>
    runCommitterPipeline(ctx, adapter, extract, gitConfig);

  return decorateRole(inner, [
    withDryRun<CommitterMeta>({
      label: "committer",
      meta: { committed: true },
      dryRun: resolveExtractDryRun(extract.dryRun),
    }),
    onFail<CommitterMeta>({ label: "committer", meta: { committed: false } }),
  ]);
}
