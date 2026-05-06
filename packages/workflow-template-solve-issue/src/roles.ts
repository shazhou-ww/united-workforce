import type { AgentFn, RoleDefinition } from "@uncaged/workflow";
import { type CoderMeta, coderMetaSchema, createCoderRole } from "@uncaged/workflow-role-coder";
import {
  type CommitterMeta,
  committerMetaSchema,
  createCommitterRole,
} from "@uncaged/workflow-role-committer";
import {
  createPlannerRole,
  type PlannerMeta,
  plannerMetaSchema,
} from "@uncaged/workflow-role-planner";
import {
  createReviewerRole,
  type ReviewerMeta,
  reviewerMetaSchema,
} from "@uncaged/workflow-role-reviewer";
import type { LlmProvider } from "@uncaged/workflow-util-role";

const DRY_RUN_PROVIDER: LlmProvider = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "template-dry-run",
};

export const SOLVE_ISSUE_WORKFLOW_DESCRIPTION =
  "Phased plan, incremental implementation per phase, review, and commit to resolve an issue end-to-end (planner → coder [repeat per phase] → reviewer → committer).";

export type SolveIssueMeta = {
  planner: PlannerMeta;
  coder: CoderMeta;
  reviewer: ReviewerMeta;
  committer: CommitterMeta;
};

const PLANNER_DRY_RUN_META: PlannerMeta = {
  phases: [
    {
      name: "phase-1",
      description: "placeholder",
      acceptance: "placeholder",
    },
  ],
};

const CODER_DRY_RUN_META: CoderMeta = {
  completedPhase: "phase-1",
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

/** Wiring for workflow-role LLM structured extraction. Use `null` for stub extract (dry-run meta from built-in placeholders). */
export type SolveIssueRolesConfig = {
  agent: AgentFn;
  agents?: Partial<{
    planner: AgentFn;
    coder: AgentFn;
    reviewer: AgentFn;
    committer: AgentFn;
  }>;
  workdir: string;
  extract: { provider: LlmProvider; dryRun: boolean | null } | null;
};

function resolveRoleAgent(
  config: SolveIssueRolesConfig,
  role: keyof NonNullable<SolveIssueRolesConfig["agents"]>,
): AgentFn {
  return config.agents?.[role] ?? config.agent;
}

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
  const coderConfig = {
    cwd: config.workdir,
  };

  const plannerAgent = resolveRoleAgent(config, "planner");
  const coderAgent = resolveRoleAgent(config, "coder");
  const reviewerAgent = resolveRoleAgent(config, "reviewer");
  const committerAgent = resolveRoleAgent(config, "committer");

  const plannerRun = createPlannerRole(plannerAgent, {
    provider: extract.provider,
    dryRun: extract.dryRun,
    dryRunMeta: PLANNER_DRY_RUN_META,
  });

  const coderRun = createCoderRole(
    coderAgent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: CODER_DRY_RUN_META,
    },
    coderConfig,
  );

  const reviewerRun = createReviewerRole(
    reviewerAgent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: REVIEWER_DRY_RUN_META,
    },
    reviewerConfig,
  );

  const committerRun = createCommitterRole(
    committerAgent,
    {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: COMMITTER_DRY_RUN_META,
    },
    committerConfig,
  );

  return {
    planner: {
      description: "Analyzes the issue and emits ordered implementation phases.",
      run: plannerRun,
      schema: plannerMetaSchema,
    },
    coder: {
      description: "Implements the next incomplete phase and reports completedPhase.",
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
