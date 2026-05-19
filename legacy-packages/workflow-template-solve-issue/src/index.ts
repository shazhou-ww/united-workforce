import type { WorkflowDefinition } from "@uncaged/workflow-runtime";

import { solveIssueTable } from "./moderator.js";
import { SOLVE_ISSUE_WORKFLOW_DESCRIPTION, type SolveIssueMeta, solveIssueRoles } from "./roles.js";

export { buildSolveIssueDescriptor } from "./descriptor.js";
export {
  type DeveloperMeta,
  developerMetaSchema,
  developerRole,
} from "./developer.js";
export { solveIssueTable } from "./moderator.js";
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
  table: solveIssueTable,
};
