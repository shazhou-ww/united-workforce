import type { Hash, Store } from "@uncaged/json-cas";
import { putSchema } from "@uncaged/json-cas";
import { START_NODE_SCHEMA, STEP_NODE_SCHEMA, WORKFLOW_SCHEMA } from "@uncaged/workflow-protocol";

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
    putSchema(store, WORKFLOW_SCHEMA),
    putSchema(store, START_NODE_SCHEMA),
    putSchema(store, STEP_NODE_SCHEMA),
  ]);
  return { workflow, startNode, stepNode };
}
