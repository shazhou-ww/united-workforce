import { err, ok, type Result } from "./result.js";

/** JSON Schema fragment describing one role's `meta` shape (subset supported by code generation). */
export type WorkflowRoleSchema = Record<string, unknown>;

export type WorkflowRoleDescriptor = {
  description: string;
  schema: WorkflowRoleSchema;
};

/** Workflow metadata exported as `export const descriptor` from TypeScript sources. */
export type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
};

export function validateWorkflowDescriptor(value: unknown): Result<WorkflowDescriptor, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return err("descriptor must be a non-array object");
  }
  const root = value as Record<string, unknown>;
  const description = root.description;
  if (typeof description !== "string") {
    return err("descriptor.description must be a string");
  }
  const rolesRaw = root.roles;
  if (rolesRaw === null || typeof rolesRaw !== "object" || Array.isArray(rolesRaw)) {
    return err("descriptor.roles must be a non-array object");
  }

  const roles: Record<string, WorkflowRoleDescriptor> = {};
  for (const [roleName, specUnknown] of Object.entries(rolesRaw)) {
    if (specUnknown === null || typeof specUnknown !== "object" || Array.isArray(specUnknown)) {
      return err(`descriptor.roles.${roleName} must be a non-array object`);
    }
    const spec = specUnknown as Record<string, unknown>;
    const roleDesc = spec.description;
    if (typeof roleDesc !== "string") {
      return err(`descriptor.roles.${roleName}.description must be a string`);
    }
    const schema = spec.schema;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
      return err(`descriptor.roles.${roleName}.schema must be a non-array object`);
    }
    roles[roleName] = {
      description: roleDesc,
      schema: schema as WorkflowRoleSchema,
    };
  }

  return ok({ description, roles });
}
