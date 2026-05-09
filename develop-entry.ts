/**
 * develop bundle entry — 小橘 🍊
 */
import { buildDevelopDescriptor, developWorkflowDefinition } from "./packages/workflow-template-develop/src/index.js";
import { createWorkflow } from "./packages/workflow-runtime/src/create-workflow.js";
import { createHermesAgent } from "./packages/workflow-agent-hermes/src/index.js";

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  return (value === undefined || value === "") ? null : value;
}

const agent = createHermesAgent({
  model: optionalEnv("WORKFLOW_HERMES_MODEL"),
  timeout: optionalEnv("WORKFLOW_HERMES_TIMEOUT") ? Number(optionalEnv("WORKFLOW_HERMES_TIMEOUT")) : null,
});

export const descriptor = buildDevelopDescriptor();
export const run = createWorkflow(developWorkflowDefinition, { agent, overrides: null });
