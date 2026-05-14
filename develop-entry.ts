import { createCursorAgent } from "./packages/workflow-agent-cursor/src/index.js";
import { createWorkflow } from "./packages/workflow-runtime/src/create-workflow.js";
import {
  buildDevelopDescriptor,
  developWorkflowDefinition,
} from "./packages/workflow-template-develop/src/index.js";

const agent = createCursorAgent({
  command: "/home/azureuser/.local/bin/cursor-agent",
  model: "auto",
  timeout: 300_000,
  workspace: null,
});

export const descriptor = buildDevelopDescriptor();
export const run = createWorkflow(developWorkflowDefinition, { adapter: agent, overrides: null });
