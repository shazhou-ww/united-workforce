import { createRoleModerator, type WorkflowDefinition, type WorkflowFn } from "@uncaged/workflow";

import { solveIssueModerator } from "./moderator.js";
import {
  createSolveIssueRoles,
  SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
  type SolveIssueMeta,
  type SolveIssueRolesConfig,
} from "./roles.js";

export { type CursorAgentConfig, createCursorAgent } from "@uncaged/workflow-agent-cursor";
export { buildSolveIssueDescriptor } from "./descriptor.js";
export { solveIssueModerator } from "./moderator.js";
export {
  type CoderMeta,
  coderMetaSchema,
  createSolveIssueRoles,
  type PlannerMeta,
  phaseSchema,
  plannerMetaSchema,
  SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
  type SolveIssueMeta,
  type SolveIssueRoles,
  type SolveIssueRolesConfig,
} from "./roles.js";

export function createSolveIssueWorkflowDefinition(
  config: SolveIssueRolesConfig,
): WorkflowDefinition<SolveIssueMeta> {
  return {
    description: SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
    roles: createSolveIssueRoles(config),
    moderator: solveIssueModerator,
  };
}

/**
 * Factory for a {@link WorkflowFn}: supply an agent and repo paths at runtime, then pass the result
 * to the bundle `run` export pattern (`createRoleModerator` is already applied).
 */
export function createSolveIssueRun(config: SolveIssueRolesConfig): WorkflowFn {
  return createRoleModerator(createSolveIssueWorkflowDefinition(config));
}
