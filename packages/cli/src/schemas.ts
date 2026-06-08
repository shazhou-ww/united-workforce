import type { Hash, Store } from "@ocas/core";
import { putSchema } from "@ocas/core";
import {
  ERROR_OUTPUT_SCHEMA,
  START_NODE_SCHEMA,
  STEP_NODE_SCHEMA,
  SUSPEND_OUTPUT_SCHEMA,
  WORKFLOW_SCHEMA,
} from "@united-workforce/protocol";

export const TEXT_SCHEMA = { type: "string" as const };

export type UwfSchemaHashes = {
  workflow: Hash;
  startNode: Hash;
  stepNode: Hash;
  text: Hash;
  errorOutput: Hash;
  suspendOutput: Hash;
};

/**
 * Register Workflow, StartNode, and StepNode JSON Schemas in the CAS store.
 * Idempotent: safe to call on every CLI invocation.
 */
export async function registerUwfSchemas(store: Store): Promise<UwfSchemaHashes> {
  const [workflow, startNode, stepNode, text, errorOutput, suspendOutput] = await Promise.all([
    putSchema(store, WORKFLOW_SCHEMA),
    putSchema(store, START_NODE_SCHEMA),
    putSchema(store, STEP_NODE_SCHEMA),
    putSchema(store, TEXT_SCHEMA),
    putSchema(store, ERROR_OUTPUT_SCHEMA),
    putSchema(store, SUSPEND_OUTPUT_SCHEMA),
  ]);
  return { workflow, startNode, stepNode, text, errorOutput, suspendOutput };
}
