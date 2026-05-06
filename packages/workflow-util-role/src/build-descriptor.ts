import type { WorkflowDescriptor, WorkflowRoleSchema } from "@uncaged/workflow";
import * as z from "zod/v4";

export type RoleDescriptorInput<M extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  schema: z.ZodType<M>;
  /** Human-readable role description; use empty string when unknown. */
  description: string | null;
};

function stripJsonSchemaMeta(json: Record<string, unknown>): WorkflowRoleSchema {
  const { $schema: _drop, ...rest } = json;
  return rest as WorkflowRoleSchema;
}

/**
 * Builds a {@link WorkflowDescriptor} from role specs, emitting JSON Schema per role via
 * `z.toJSONSchema`.
 */
export function buildDescriptorFromRoles(args: {
  description: string;
  roles: Record<string, RoleDescriptorInput>;
}): WorkflowDescriptor {
  const roles: WorkflowDescriptor["roles"] = {};
  for (const [key, spec] of Object.entries(args.roles)) {
    if (spec.name !== key) {
      throw new Error(
        `buildDescriptorFromRoles: role key "${key}" must match spec.name "${spec.name}"`,
      );
    }
    const rawJsonSchema = z.toJSONSchema(spec.schema) as Record<string, unknown>;
    roles[key] = {
      description: spec.description === null ? "" : spec.description,
      schema: stripJsonSchemaMeta(rawJsonSchema),
    };
  }
  return { description: args.description, roles };
}
