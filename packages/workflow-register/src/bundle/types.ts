import type { WorkflowDescriptor, WorkflowFn } from "@uncaged/workflow-protocol";

export type {
  WorkflowDescriptor,
  WorkflowFn,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowRoleDescriptor,
  WorkflowRoleSchema,
} from "@uncaged/workflow-protocol";

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
