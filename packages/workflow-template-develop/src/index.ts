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
export {
  type TesterMeta,
  testerMetaSchema,
  testerRole,
} from "@uncaged/workflow-role-tester";
export { buildDevelopDescriptor } from "./descriptor.js";
export { developModerator } from "./moderator.js";
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
