import type { WorkflowFn } from "../types.js";

/** JSON Schema fragment describing one role's `meta` shape (subset supported by code generation). */
export type WorkflowRoleSchema = Record<string, unknown>;

export type WorkflowRoleDescriptor = {
  description: string;
  schema: WorkflowRoleSchema;
};

/** Workflow metadata exported as `export const descriptor` from `.esm.js` bundles. */
export type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
};

export type WorkflowBundleValidationInput = {
  /** Absolute or relative path (used for `.esm.js` suffix checks). */
  filePath: string;
  /** UTF-8 source of the bundle. */
  source: string;
};

export type ExtractedBundleExports = {
  run: WorkflowFn;
  descriptor: WorkflowDescriptor;
};

export type ExtractBundleExportsOptions = {
  /** When set, ensures `node_modules/@uncaged/workflow` exists under this root before import. */
  storageRoot: string | null;
};
