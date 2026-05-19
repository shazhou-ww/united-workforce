import { buildDescriptor } from "@uncaged/workflow-register";

import { solveIssueTable } from "./moderator.js";
import { SOLVE_ISSUE_WORKFLOW_DESCRIPTION, solveIssueRoles } from "./roles.js";

export function buildSolveIssueDescriptor() {
  return buildDescriptor({
    description: SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
    roles: solveIssueRoles,
    table: solveIssueTable,
  });
}
