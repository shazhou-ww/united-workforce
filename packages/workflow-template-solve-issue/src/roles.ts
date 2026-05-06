import type { AgentFn, RoleDefinition } from "@uncaged/workflow";
import { createRole } from "@uncaged/workflow-agent-llm";
import {
  type CommitterMeta,
  committerMetaSchema,
  createCommitterRole,
} from "@uncaged/workflow-role-committer";
import {
  createReviewerRole,
  type ReviewerMeta,
  reviewerMetaSchema,
} from "@uncaged/workflow-role-reviewer";
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

export const SOLVE_ISSUE_WORKFLOW_DESCRIPTION =
  "Plan, implement, review, and commit changes to resolve an issue end-to-end (planner → coder → reviewer → committer).";

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
  planner: RoleDefinition<PlannerMeta>;
  coder: RoleDefinition<CoderMeta>;
  reviewer: RoleDefinition<ReviewerMeta>;
  committer: RoleDefinition<CommitterMeta>;
};

export function createSolveIssueRoles(config: SolveIssueRolesConfig): SolveIssueRoles {
  const extract = resolveExtract(config);
  const reviewerConfig = {
    cwd: config.workdir,
  };
  const committerConfig = {
    cwd: config.workdir,
  };

  const plannerRun = createRole({
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

  const coderRun = createRole({
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

  const reviewerRun = createReviewerRole(
    config.agent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: REVIEWER_DRY_RUN_META,
    },
    reviewerConfig,
  );

  const committerRun = createCommitterRole(
    config.agent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: COMMITTER_DRY_RUN_META,
    },
    committerConfig,
  );

  return {
    planner: {
      description: "Analyzes the issue and proposes plan, files, and approach.",
      run: plannerRun,
      schema: plannerMetaSchema,
    },
    coder: {
      description: "Implements the planner output and summarizes touched files.",
      run: coderRun,
      schema: coderMetaSchema,
    },
    reviewer: {
      description: "Runs git diff checks and sets approved when the change is ready.",
      run: reviewerRun,
      schema: reviewerMetaSchema,
    },
    committer: {
      description: "Creates branch, commits, and pushes when review passes.",
      run: committerRun,
      schema: committerMetaSchema,
    },
  };
}
