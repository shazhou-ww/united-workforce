import { buildDescriptor } from "@uncaged/workflow-register";

import { developTable } from "./moderator.js";
import { DEVELOP_WORKFLOW_DESCRIPTION, developRoles } from "./roles.js";

export function buildDevelopDescriptor() {
  return buildDescriptor({
    description: DEVELOP_WORKFLOW_DESCRIPTION,
    roles: developRoles,
    table: developTable,
  });
}
