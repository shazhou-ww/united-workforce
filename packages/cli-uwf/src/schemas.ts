import type { Hash, JSONSchema, Store } from "@uncaged/json-cas";
import { putSchema } from "@uncaged/json-cas";

const ROLE_DEFINITION: JSONSchema = {
  type: "object",
  required: ["description", "systemPrompt", "outputSchema"],
  properties: {
    description: { type: "string" },
    systemPrompt: { type: "string" },
    outputSchema: { type: "string", format: "cas_ref" },
  },
  additionalProperties: false,
};

const CONDITION_DEFINITION: JSONSchema = {
  type: "object",
  required: ["description", "expression"],
  properties: {
    description: { type: "string" },
    expression: { type: "string" },
  },
  additionalProperties: false,
};

const TRANSITION: JSONSchema = {
  type: "object",
  required: ["role", "condition"],
  properties: {
    role: { type: "string" },
    condition: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  additionalProperties: false,
};

const WORKFLOW: JSONSchema = {
  type: "object",
  required: ["name", "description", "roles", "conditions", "graph"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    roles: {
      type: "object",
      additionalProperties: ROLE_DEFINITION,
    },
    conditions: {
      type: "object",
      additionalProperties: CONDITION_DEFINITION,
    },
    graph: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: TRANSITION,
      },
    },
  },
  additionalProperties: false,
};

const START_NODE: JSONSchema = {
  type: "object",
  required: ["workflow", "prompt"],
  properties: {
    workflow: { type: "string", format: "cas_ref" },
    prompt: { type: "string" },
  },
  additionalProperties: false,
};

export type UwfSchemaHashes = {
  workflow: Hash;
  startNode: Hash;
};

/**
 * Register Workflow and StartNode JSON Schemas in the CAS store.
 * Idempotent: safe to call on every CLI invocation.
 */
export async function registerUwfSchemas(store: Store): Promise<UwfSchemaHashes> {
  const [workflow, startNode] = await Promise.all([
    putSchema(store, WORKFLOW),
    putSchema(store, START_NODE),
  ]);
  return { workflow, startNode };
}
