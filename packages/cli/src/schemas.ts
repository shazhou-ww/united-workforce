import type { Hash, Store } from "@ocas/core";
import { bootstrap, putSchema } from "@ocas/core";
import {
  ERROR_OUTPUT_SCHEMA,
  OUTPUT_SCHEMAS,
  OUTPUT_TEMPLATES,
  type OutputSchemaName,
  outputSchemaVarName,
  START_NODE_SCHEMA,
  STEP_COMPLETE_SCHEMA,
  STEP_NODE_SCHEMA,
  STEP_START_SCHEMA,
  SUSPEND_OUTPUT_SCHEMA,
  TURN_NODE_SCHEMA,
  WORKFLOW_SCHEMA,
} from "@united-workforce/protocol";

export const TEXT_SCHEMA = { type: "string" as const };

export type UwfSchemaHashes = {
  workflow: Hash;
  startNode: Hash;
  stepNode: Hash;
  stepStart: Hash;
  stepComplete: Hash;
  turnNode: Hash;
  text: Hash;
  errorOutput: Hash;
  suspendOutput: Hash;
  outputs: Record<OutputSchemaName, Hash>;
};

/**
 * Register every uwf JSON Schema (workflow / start / step / error / suspend
 * + the 9 CLI output envelopes) and the matching `text` Liquid templates.
 * Idempotent: safe to call on every CLI invocation.
 */
export async function registerUwfSchemas(store: Store): Promise<UwfSchemaHashes> {
  const [
    workflow,
    startNode,
    stepNode,
    stepStart,
    stepComplete,
    turnNode,
    text,
    errorOutput,
    suspendOutput,
  ] = await Promise.all([
    putSchema(store, WORKFLOW_SCHEMA),
    putSchema(store, START_NODE_SCHEMA),
    putSchema(store, STEP_NODE_SCHEMA),
    putSchema(store, STEP_START_SCHEMA),
    putSchema(store, STEP_COMPLETE_SCHEMA),
    putSchema(store, TURN_NODE_SCHEMA),
    putSchema(store, TEXT_SCHEMA),
    putSchema(store, ERROR_OUTPUT_SCHEMA),
    putSchema(store, SUSPEND_OUTPUT_SCHEMA),
  ]);
  const outputs = await registerOutputSchemas(store);
  return {
    workflow,
    startNode,
    stepNode,
    stepStart,
    stepComplete,
    turnNode,
    text,
    errorOutput,
    suspendOutput,
    outputs,
  };
}

/**
 * Register the 9 CLI output schemas, bind `@uwf/output/<name>` to each, store
 * each Liquid template as an `@ocas/string` CAS node, and bind
 * `@ocas/template/text/<schemaHash>` to the template content hash.
 *
 * Idempotent: writes are content-addressed so repeat invocations no-op.
 */
async function registerOutputSchemas(store: Store): Promise<Record<OutputSchemaName, Hash>> {
  const aliases = bootstrap(store);
  const stringHash = aliases["@ocas/string"];
  if (stringHash === undefined) {
    throw new Error("@ocas/string schema not found in bootstrap result");
  }

  const result = {} as Record<OutputSchemaName, Hash>;
  const names = Object.keys(OUTPUT_SCHEMAS) as OutputSchemaName[];
  for (const name of names) {
    const schemaHash = await putSchema(store, OUTPUT_SCHEMAS[name]);
    store.var.set(outputSchemaVarName(name), schemaHash);

    const template = OUTPUT_TEMPLATES[name];
    const contentHash = store.cas.put(stringHash, template);
    store.var.set(`@ocas/template/text/${schemaHash}`, contentHash);

    result[name] = schemaHash;
  }
  return result;
}
