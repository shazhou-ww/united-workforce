import type { WorkflowDefinition } from "@uncaged/workflow-runtime";

import { developTable } from "./moderator.js";
import { DEVELOP_WORKFLOW_DESCRIPTION, type DevelopMeta, developRoles } from "./roles.js";

export { buildDevelopDescriptor } from "./descriptor.js";
export { developTable } from "./moderator.js";
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
  table: developTable,
};
