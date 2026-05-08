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
