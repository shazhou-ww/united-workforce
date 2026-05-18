import type { WorkflowDefinition } from "@uncaged/workflow-runtime";
import { documentTable } from "./moderator.js";
import { DOCUMENT_WORKFLOW_DESCRIPTION, type DocumentMeta, documentRoles } from "./roles.js";

export { buildDocumentDescriptor } from "./descriptor.js";
export { documentTable } from "./moderator.js";
export {
  type DifferMeta,
  differMetaSchema,
  differRole,
  type WriterMeta,
  writerMetaSchema,
  writerRole,
} from "./roles/index.js";
export {
  DOCUMENT_WORKFLOW_DESCRIPTION,
  type DocumentMeta,
  type DocumentRoles,
  documentRoles,
} from "./roles.js";
export type { DocumentStartInput } from "./types.js";

export const documentWorkflowDefinition: WorkflowDefinition<DocumentMeta> = {
  description: DOCUMENT_WORKFLOW_DESCRIPTION,
  roles: documentRoles,
  table: documentTable,
};
