import { createRoleModerator, type WorkflowFn } from "@uncaged/workflow";

import { solveIssueModerator } from "./moderator.js";
import { createSolveIssueRoles, type SolveIssueMeta, type SolveIssueRolesConfig } from "./roles.js";

export { type CursorAgentConfig, createCursorAgent } from "@uncaged/workflow-agent-cursor";
export { buildSolveIssueDescriptor } from "./descriptor.js";
export { solveIssueModerator } from "./moderator.js";
export {
  type CoderMeta,
  coderMetaSchema,
  createSolveIssueRoles,
  type PlannerMeta,
  plannerMetaSchema,
  type SolveIssueMeta,
  type SolveIssueRoles,
  type SolveIssueRolesConfig,
} from "./roles.js";

/**
 * Factory for a {@link WorkflowFn}: supply an agent and repo paths at runtime, then pass the result
 * to the bundle `run` export pattern (`createRoleModerator` is already applied).
 */
export function createSolveIssueRun(config: SolveIssueRolesConfig): WorkflowFn {
  return createRoleModerator<SolveIssueMeta>({
    roles: createSolveIssueRoles(config),
    moderator: solveIssueModerator,
  });
}
