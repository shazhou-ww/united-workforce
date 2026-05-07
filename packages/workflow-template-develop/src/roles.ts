import type { RoleDefinition } from "@uncaged/workflow";
import { type CoderMeta, coderRole } from "@uncaged/workflow-role-coder";
import { type CommitterMeta, committerRole } from "@uncaged/workflow-role-committer";
import { type PlannerMeta, plannerRole } from "@uncaged/workflow-role-planner";
import { type ReviewerMeta, reviewerRole } from "@uncaged/workflow-role-reviewer";
import { type TesterMeta, testerRole } from "@uncaged/workflow-role-tester";

export const DEVELOP_WORKFLOW_DESCRIPTION =
  "Plan phases, implement incrementally, review, verify with tests/build/lint, and commit (planner → coder [repeat per phase] → reviewer → tester → committer).";

export type DevelopMeta = {
  planner: PlannerMeta;
  coder: CoderMeta;
  reviewer: ReviewerMeta;
  tester: TesterMeta;
  committer: CommitterMeta;
};

export type DevelopRoles = {
  [K in keyof DevelopMeta]: RoleDefinition<DevelopMeta[K]>;
};

export const developRoles: DevelopRoles = {
  planner: plannerRole,
  coder: coderRole,
  reviewer: reviewerRole,
  tester: testerRole,
  committer: committerRole,
};
