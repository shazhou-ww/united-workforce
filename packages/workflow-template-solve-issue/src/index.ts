import {
  type AgentBinding,
  createWorkflow,
  type ExtractFn,
  type WorkflowDefinition,
  type WorkflowFn,
} from "@uncaged/workflow";

import { solveIssueModerator } from "./moderator.js";
import { SOLVE_ISSUE_WORKFLOW_DESCRIPTION, type SolveIssueMeta, solveIssueRoles } from "./roles.js";

export {
  type CoderMeta,
  coderMetaSchema,
  coderRole,
} from "@uncaged/workflow-role-coder";
export {
  type CommitterMeta,
  committerMetaSchema,
  committerRole,
} from "@uncaged/workflow-role-committer";
export {
  type PlannerMeta,
  phaseSchema,
  plannerMetaSchema,
  plannerRole,
} from "@uncaged/workflow-role-planner";
export {
  type ReviewerMeta,
  reviewerMetaSchema,
  reviewerRole,
} from "@uncaged/workflow-role-reviewer";
export { buildSolveIssueDescriptor } from "./descriptor.js";
export { solveIssueModerator } from "./moderator.js";
export {
  SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
  type SolveIssueMeta,
  type SolveIssueRoles,
  solveIssueRoles,
} from "./roles.js";

export const solveIssueWorkflowDefinition: WorkflowDefinition<SolveIssueMeta> = {
  description: SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
  roles: solveIssueRoles,
  moderator: solveIssueModerator,
};

export function createSolveIssueRun(binding: AgentBinding, extract: ExtractFn): WorkflowFn {
  return createWorkflow(solveIssueWorkflowDefinition, binding, extract);
}
