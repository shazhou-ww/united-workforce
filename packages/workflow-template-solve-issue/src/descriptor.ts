import { buildDescriptor } from "@uncaged/workflow-register";

import { solveIssueModerator } from "./moderator.js";
import { SOLVE_ISSUE_WORKFLOW_DESCRIPTION, solveIssueRoles } from "./roles.js";

export function buildSolveIssueDescriptor() {
  return buildDescriptor({
    description: SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
    roles: solveIssueRoles,
    moderator: solveIssueModerator,
  });
}
