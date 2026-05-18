import type { RoleDefinition } from "@uncaged/workflow-runtime";
import { type DifferMeta, differRole } from "./roles/differ.js";
import { type WriterMeta, writerRole } from "./roles/writer.js";

export const DOCUMENT_WORKFLOW_DESCRIPTION =
  "Generates a new Word document from a prompt, or edits an existing one and produces a diff report.";

export type DocumentMeta = {
  writer: WriterMeta;
  differ: DifferMeta;
};

export type DocumentRoles = {
  [K in keyof DocumentMeta]: RoleDefinition<DocumentMeta[K]>;
};

export const documentRoles: DocumentRoles = {
  writer: writerRole,
  differ: differRole,
};
