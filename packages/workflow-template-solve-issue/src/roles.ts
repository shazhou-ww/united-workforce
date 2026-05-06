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

const PLANNER_SYSTEM = `You are a **planner** for a software task. Break the work into **sequential phases** the coder will execute one at a time.

Each phase must have: a short **name** (stable identifier), a **description** of what to do in that phase, and **acceptance** criteria for when that phase is done.

Order phases so earlier steps unblock later ones. Cover root cause, edge cases, and verification across the phases. Do not emit separate file lists or a free-form "approach" field — put that detail inside phase descriptions.`;

const CODER_SYSTEM = `You are a **coder**. Read the thread: the planner produced ordered **phases**. Identify the **next** phase that is not yet completed according to prior coder steps (each coder step reports a completedPhase).

Implement **only that phase** — do not tackle multiple phases in one turn unless the planner defined a single phase. Follow project conventions; summarize what changed and list touched files.

When done with the phase you worked on, set **completedPhase** to that phase's **name** exactly as given by the planner.`;

export const SOLVE_ISSUE_WORKFLOW_DESCRIPTION =
  "Phased plan, incremental implementation per phase, review, and commit to resolve an issue end-to-end (planner → coder [repeat per phase] → reviewer → committer).";

export const phaseSchema = z.object({
  name: z.string(),
  description: z.string(),
  acceptance: z.string(),
});

export const plannerMetaSchema = z.object({
  phases: z.array(phaseSchema),
});

export const coderMetaSchema = z.object({
  completedPhase: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type PlannerMeta = z.infer<typeof plannerMetaSchema>;

export type CoderMeta = z.infer<typeof coderMetaSchema>;

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

export type SolveIssueMeta = {
  planner: PlannerMeta;
  coder: CoderMeta;
  reviewer: ReviewerMeta;
  committer: CommitterMeta;
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

  const plannerAgent = resolveRoleAgent(config, "planner");
  const coderAgent = resolveRoleAgent(config, "coder");
  const reviewerAgent = resolveRoleAgent(config, "reviewer");
  const committerAgent = resolveRoleAgent(config, "committer");

  const plannerRun = createRole({
    name: "planner",
    schema: plannerMetaSchema,
    systemPrompt: PLANNER_SYSTEM,
    agent: plannerAgent,
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
    agent: coderAgent,
    extract: {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: CODER_DRY_RUN_META,
    },
  });

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
