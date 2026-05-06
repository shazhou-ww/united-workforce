import { jsonSchemaToTypeString } from "./json-schema-to-ts.js";
import type { WorkflowDescriptor } from "./workflow-descriptor.js";

function safePropertyName(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** Build the standard workflow bundle `.d.ts` from role JSON Schemas. */
export function generateWorkflowBundleTypes(descriptor: WorkflowDescriptor): string {
  const roleLines: string[] = [];
  for (const [roleName, role] of Object.entries(descriptor.roles)) {
    const tsType = jsonSchemaToTypeString(role.schema);
    roleLines.push(`  ${safePropertyName(roleName)}: ${tsType};`);
  }

  return [
    `import type { WorkflowFn } from "@uncaged/workflow";`,
    ``,
    `export type Roles = {`,
    ...roleLines,
    `};`,
    ``,
    `declare const workflow: WorkflowFn;`,
    `export default workflow;`,
    ``,
  ].join("\n");
}
