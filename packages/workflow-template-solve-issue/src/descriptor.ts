import { buildDescriptor } from "@uncaged/workflow";

import { solveIssueModerator } from "./moderator.js";
import {
  createSolveIssueRoles,
  SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
  type SolveIssueRolesConfig,
} from "./roles.js";

const BUILD_DESCRIPTOR_CONFIG: SolveIssueRolesConfig = {
  agent: async () => "",
  workdir: "/tmp/uncaged-workflow-descriptor-stub",
  extract: null,
};

export function buildSolveIssueDescriptor() {
  return buildDescriptor({
    description: SOLVE_ISSUE_WORKFLOW_DESCRIPTION,
    roles: createSolveIssueRoles(BUILD_DESCRIPTOR_CONFIG),
    moderator: solveIssueModerator,
  });
}
