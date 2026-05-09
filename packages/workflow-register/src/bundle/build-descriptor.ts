import type { RoleMeta, WorkflowDefinition } from "@uncaged/workflow-protocol";
import * as z from "zod/v4";
import type { WorkflowDescriptor, WorkflowRoleSchema } from "./types.js";

function stripJsonSchemaMeta(json: Record<string, unknown>): WorkflowRoleSchema {
  const { $schema: _drop, ...rest } = json;
  return rest as WorkflowRoleSchema;
}

export function buildDescriptor<M extends RoleMeta>(
  def: WorkflowDefinition<M>,
): WorkflowDescriptor {
  const roles: WorkflowDescriptor["roles"] = {};
  for (const [key, roleDef] of Object.entries(def.roles) as Array<
    [string, { description: string; schema: z.ZodType }]
  >) {
    const rawJsonSchema = z.toJSONSchema(roleDef.schema) as Record<string, unknown>;
    roles[key] = {
      description: roleDef.description,
      schema: stripJsonSchemaMeta(rawJsonSchema),
    };
  }
  return { description: def.description, roles };
}
