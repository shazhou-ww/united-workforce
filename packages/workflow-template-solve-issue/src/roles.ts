import type { RoleDefinition } from "@uncaged/workflow";
import { type CoderMeta, coderRole } from "@uncaged/workflow-role-coder";
import { type CommitterMeta, committerRole } from "@uncaged/workflow-role-committer";
import { type PlannerMeta, plannerRole } from "@uncaged/workflow-role-planner";
import { type ReviewerMeta, reviewerRole } from "@uncaged/workflow-role-reviewer";

export const SOLVE_ISSUE_WORKFLOW_DESCRIPTION =
  "Phased plan, incremental implementation per phase, review, and commit to resolve an issue end-to-end (planner → coder [repeat per phase] → reviewer → committer).";

export type SolveIssueMeta = {
  planner: PlannerMeta;
  coder: CoderMeta;
  reviewer: ReviewerMeta;
  committer: CommitterMeta;
};

export type SolveIssueRoles = {
  [K in keyof SolveIssueMeta]: RoleDefinition<SolveIssueMeta[K]>;
};

export const solveIssueRoles: SolveIssueRoles = {
  planner: plannerRole,
  coder: coderRole,
  reviewer: reviewerRole,
  committer: committerRole,
};
