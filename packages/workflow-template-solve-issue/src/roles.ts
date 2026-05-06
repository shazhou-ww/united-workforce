import type { AgentFn, Role } from "@uncaged/workflow";
import { createRole } from "@uncaged/workflow-agent-llm";
import { type CommitterMeta, createCommitterRole } from "@uncaged/workflow-role-committer";
import { createReviewerRole, type ReviewerMeta } from "@uncaged/workflow-role-reviewer";
import type { LlmProvider } from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

const DRY_RUN_PROVIDER: LlmProvider = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "template-dry-run",
};

const PLANNER_SYSTEM = `You are a **planner** for a software task. Analyze the issue, list relevant files, and produce a clear step-by-step approach.

Focus on: root cause, edge cases, and how the implementation will be verified. Output enough detail for a coding agent to implement without guessing.`;

const CODER_SYSTEM = `You are a **coder**. The previous step produced a plan: read the thread and implement that plan in the repository.

Make focused changes, follow project conventions, and explain what you changed.`;

export const plannerMetaSchema = z.object({
  plan: z.string(),
  files: z.array(z.string()),
  approach: z.string(),
});

export const coderMetaSchema = z.object({
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type PlannerMeta = z.infer<typeof plannerMetaSchema>;

export type CoderMeta = z.infer<typeof coderMetaSchema>;

const PLANNER_DRY_RUN_META: PlannerMeta = {
  plan: "",
  files: [],
  approach: "",
};

const CODER_DRY_RUN_META: CoderMeta = {
  filesChanged: [],
  summary: "",
};

const REVIEWER_DRY_RUN_META: ReviewerMeta = {
  status: "approved",
};

const COMMITTER_DRY_RUN_META: CommitterMeta = {
  status: "committed",
  branch: "dry-run/placeholder",
  commitSha: "0000000",
};

export type SolveIssueMeta = {
  planner: PlannerMeta;
  coder: CoderMeta;
  reviewer: ReviewerMeta;
  committer: CommitterMeta;
};

/** Wiring for workflow-role LLM structured extraction. Use `null` for stub extract (dry-run meta from built-in placeholders). */
export type SolveIssueRolesConfig = {
  agent: AgentFn;
  workdir: string;
  extract: { provider: LlmProvider; dryRun: boolean | null } | null;
};

function resolveExtract(config: SolveIssueRolesConfig): {
  provider: LlmProvider;
  dryRun: boolean | null;
} {
  if (config.extract === null) {
    return { provider: DRY_RUN_PROVIDER, dryRun: true };
  }
  return config.extract;
}

export type SolveIssueRoles = {
  planner: Role<PlannerMeta>;
  coder: Role<CoderMeta>;
  reviewer: Role<ReviewerMeta>;
  committer: Role<CommitterMeta>;
};

export function createSolveIssueRoles(config: SolveIssueRolesConfig): SolveIssueRoles {
  const extract = resolveExtract(config);
  const reviewerConfig = {
    cwd: config.workdir,
  };
  const committerConfig = {
    cwd: config.workdir,
  };

  const planner: Role<PlannerMeta> = createRole({
    name: "planner",
    schema: plannerMetaSchema,
    systemPrompt: PLANNER_SYSTEM,
    agent: config.agent,
    extract: {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: PLANNER_DRY_RUN_META,
    },
  });

  const coder: Role<CoderMeta> = createRole({
    name: "coder",
    schema: coderMetaSchema,
    systemPrompt: CODER_SYSTEM,
    agent: config.agent,
    extract: {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: CODER_DRY_RUN_META,
    },
  });

  const reviewer: Role<ReviewerMeta> = createReviewerRole(
    config.agent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: REVIEWER_DRY_RUN_META,
    },
    reviewerConfig,
  );

  const committer: Role<CommitterMeta> = createCommitterRole(
    config.agent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: COMMITTER_DRY_RUN_META,
    },
    committerConfig,
  );

  return { planner, coder, reviewer, committer };
}
