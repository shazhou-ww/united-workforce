import {
  type AgentBinding,
  createWorkflow,
  type ExtractFn,
  type LlmProvider,
  type WorkflowDefinition,
  type WorkflowFn,
  workflowAsAgent,
} from "@uncaged/workflow";

import { solveIssueModerator } from "./moderator.js";
import { SOLVE_ISSUE_WORKFLOW_DESCRIPTION, type SolveIssueMeta, solveIssueRoles } from "./roles.js";

export { buildSolveIssueDescriptor } from "./descriptor.js";
export {
  type DeveloperMeta,
  developerMetaSchema,
  developerRole,
} from "./developer.js";
export { solveIssueModerator } from "./moderator.js";
export {
  type PreparerMeta,
  preparerMetaSchema,
  preparerRole,
  type SubmitterMeta,
  submitterMetaSchema,
  submitterRole,
} from "./roles/index.js";
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

/**
 * Build the solve-issue {@link WorkflowFn}.
 *
 * The `developer` role always delegates to the registered `develop` workflow via
 * {@link workflowAsAgent}; if the caller supplies their own `developer` override in
 * `binding.overrides`, it takes precedence so tests and custom hosts can stub it.
 */
export function createSolveIssueRun(
  binding: AgentBinding,
  extract: ExtractFn,
  llmProvider: LlmProvider | null,
): WorkflowFn {
  const developerOverride = binding.overrides?.developer ?? workflowAsAgent("develop");
  const mergedBinding: AgentBinding = {
    agent: binding.agent,
    overrides: {
      ...(binding.overrides ?? {}),
      developer: developerOverride,
    },
  };
  return createWorkflow(solveIssueWorkflowDefinition, mergedBinding, extract, llmProvider);
}
