import type {
  ModeratorTable,
  ModeratorTransition,
  RoleMeta,
  WorkflowDefinition,
  WorkflowDescriptor,
  WorkflowGraph,
  WorkflowGraphEdge,
} from "@uncaged/workflow-protocol";
import { END } from "@uncaged/workflow-protocol";
import * as z from "zod/v4";
import type { WorkflowRoleSchema } from "./types.js";

function stripJsonSchemaMeta(json: Record<string, unknown>): WorkflowRoleSchema {
  const { $schema: _drop, ...rest } = json;
  return rest as WorkflowRoleSchema;
}

function graphFromTable<M extends RoleMeta>(table: ModeratorTable<M>): WorkflowGraph {
  const edges: WorkflowGraphEdge[] = [];
  const entries = Object.entries(table) as Array<[string, ModeratorTransition<M>[]]>;
  for (const [from, transitions] of entries) {
    for (const t of transitions) {
      const conditionName = t.condition === "FALLBACK" ? "FALLBACK" : t.condition.name;
      const conditionDescription = t.condition === "FALLBACK" ? null : t.condition.description;
      const to = t.role === END ? END : t.role;
      edges.push({ from, to, condition: conditionName, conditionDescription });
    }
  }
  return { edges };
}

export function buildDescriptor<M extends RoleMeta>(
  def: WorkflowDefinition<M>,
): WorkflowDescriptor {
  const roles: WorkflowDescriptor["roles"] = {};
  for (const [key, roleDef] of Object.entries(def.roles) as Array<
    [string, { description: string; systemPrompt: string; schema: z.ZodType }]
  >) {
    const rawJsonSchema = z.toJSONSchema(roleDef.schema) as Record<string, unknown>;
    roles[key] = {
      description: roleDef.description,
      systemPrompt: roleDef.systemPrompt,
      schema: stripJsonSchemaMeta(rawJsonSchema),
    };
  }
  return {
    description: def.description,
    roles,
    graph: graphFromTable(def.table),
  };
}
