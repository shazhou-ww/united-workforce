import type { Hash, JSONSchema, Store } from "@uncaged/json-cas";
import { putSchema } from "@uncaged/json-cas";

const STEP_NODE: JSONSchema = {
  type: "object",
  required: ["start", "prev", "role", "output", "detail", "agent"],
  properties: {
    start: { type: "string", format: "cas_ref" },
    prev: {
      anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
    },
    role: { type: "string" },
    output: { type: "string", format: "cas_ref" },
    detail: { type: "string", format: "cas_ref" },
    agent: { type: "string" },
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

const WORKFLOW: JSONSchema = {
  type: "object",
  required: ["name", "description", "roles", "conditions", "graph"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    roles: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["description", "systemPrompt", "outputSchema"],
        properties: {
          description: { type: "string" },
          systemPrompt: { type: "string" },
          outputSchema: { type: "string", format: "cas_ref" },
        },
        additionalProperties: false,
      },
    },
    conditions: { type: "object" },
    graph: { type: "object" },
  },
  additionalProperties: false,
};

export type UwfAgentSchemaHashes = {
  workflow: Hash;
  startNode: Hash;
  stepNode: Hash;
};

/**
 * Register Workflow, StartNode, and StepNode JSON Schemas in the CAS store.
 * Idempotent: safe to call on every agent invocation.
 */
export async function registerAgentSchemas(store: Store): Promise<UwfAgentSchemaHashes> {
  const [workflow, startNode, stepNode] = await Promise.all([
    putSchema(store, WORKFLOW),
    putSchema(store, START_NODE),
    putSchema(store, STEP_NODE),
  ]);
  return { workflow, startNode, stepNode };
}
