import type { RoleDefinition } from "@uncaged/workflow";
import { type CoderMeta, coderRole } from "@uncaged/workflow-role-coder";
import { type CommitterMeta, committerRole } from "@uncaged/workflow-role-committer";
import { type PlannerMeta, plannerRole } from "@uncaged/workflow-role-planner";
import { type PreparerMeta, preparerRole } from "@uncaged/workflow-role-preparer";
import { type ReviewerMeta, reviewerRole } from "@uncaged/workflow-role-reviewer";

export const SOLVE_ISSUE_WORKFLOW_DESCRIPTION =
  "Prepare repo context, plan phases, implement incrementally, review, and commit to resolve an issue end-to-end (preparer → planner → coder [repeat per phase] → reviewer → committer).";

export type SolveIssueMeta = {
  preparer: PreparerMeta;
  planner: PlannerMeta;
  coder: CoderMeta;
  reviewer: ReviewerMeta;
  committer: CommitterMeta;
};

export type SolveIssueRoles = {
  [K in keyof SolveIssueMeta]: RoleDefinition<SolveIssueMeta[K]>;
};

export const solveIssueRoles: SolveIssueRoles = {
  preparer: preparerRole,
  planner: plannerRole,
  coder: coderRole,
  reviewer: reviewerRole,
  committer: committerRole,
};
