import { buildDescriptor } from "@uncaged/workflow-register";
import { documentTable } from "./moderator.js";
import { DOCUMENT_WORKFLOW_DESCRIPTION, documentRoles } from "./roles.js";

export function buildDocumentDescriptor() {
  return buildDescriptor({
    description: DOCUMENT_WORKFLOW_DESCRIPTION,
    roles: documentRoles,
    table: documentTable,
  });
}
