import type { Hash, Store } from "@ocas/core";
import { putSchema } from "@ocas/core";
import { START_NODE_SCHEMA, STEP_NODE_SCHEMA, WORKFLOW_SCHEMA } from "@united-workforce/protocol";

export type UwfAgentSchemaHashes = {
  workflow: Hash;
  startNode: Hash;
  stepNode: Hash;
  text: Hash;
};

const TEXT_SCHEMA = { type: "string" as const };

/**
 * Register Workflow, StartNode, and StepNode JSON Schemas in the CAS store.
 * Idempotent: safe to call on every agent invocation.
 */
export async function registerAgentSchemas(store: Store): Promise<UwfAgentSchemaHashes> {
  const [workflow, startNode, stepNode, text] = await Promise.all([
    putSchema(store, WORKFLOW_SCHEMA),
    putSchema(store, START_NODE_SCHEMA),
    putSchema(store, STEP_NODE_SCHEMA),
    putSchema(store, TEXT_SCHEMA),
  ]);
  return { workflow, startNode, stepNode, text };
}
