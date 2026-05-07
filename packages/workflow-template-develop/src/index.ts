import {
  type AgentBinding,
  createWorkflow,
  type ExtractFn,
  type LlmProvider,
  type WorkflowDefinition,
  type WorkflowFn,
} from "@uncaged/workflow";

import { developModerator } from "./moderator.js";
import { DEVELOP_WORKFLOW_DESCRIPTION, type DevelopMeta, developRoles } from "./roles.js";

export { buildDevelopDescriptor } from "./descriptor.js";
export { developModerator } from "./moderator.js";
export {
  type CoderMeta,
  type CommitterMeta,
  coderMetaSchema,
  coderRole,
  committerMetaSchema,
  committerRole,
  type PlannerMeta,
  phaseSchema,
  plannerMetaSchema,
  plannerRole,
  type ReviewerMeta,
  reviewerMetaSchema,
  reviewerRole,
  type TesterMeta,
  testerMetaSchema,
  testerRole,
} from "./roles/index.js";
export {
  DEVELOP_WORKFLOW_DESCRIPTION,
  type DevelopMeta,
  type DevelopRoles,
  developRoles,
} from "./roles.js";

export const developWorkflowDefinition: WorkflowDefinition<DevelopMeta> = {
  description: DEVELOP_WORKFLOW_DESCRIPTION,
  roles: developRoles,
  moderator: developModerator,
};

export function createDevelopRun(
  binding: AgentBinding,
  extract: ExtractFn,
  llmProvider: LlmProvider | null,
): WorkflowFn {
  return createWorkflow(developWorkflowDefinition, binding, extract, llmProvider);
}
