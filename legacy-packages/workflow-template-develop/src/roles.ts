import type { RoleDefinition } from "@uncaged/workflow-runtime";
import { type CoderMeta, coderRole } from "./roles/coder.js";
import { type CommitterMeta, committerRole } from "./roles/committer.js";
import { type PlannerMeta, plannerRole } from "./roles/planner.js";
import { type ReviewerMeta, reviewerRole } from "./roles/reviewer.js";
import { type TesterMeta, testerRole } from "./roles/tester.js";

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
