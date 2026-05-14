/**
 * develop bundle entry — 小橘 🍊
 *
 * All roles use cursor-agent with workspace auto-extracted from context.
 */
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { optionalEnv, requireEnv } from "@uncaged/workflow-util";
import { buildDevelopDescriptor, developWorkflowDefinition } from "./src/index.js";

const adapter = createCursorAgent({
  command: requireEnv("WORKFLOW_CURSOR_COMMAND", "set WORKFLOW_CURSOR_COMMAND (e.g. cursor-agent)"),
  model: optionalEnv("WORKFLOW_CURSOR_MODEL"),
  timeout: optionalEnv("WORKFLOW_CURSOR_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_CURSOR_TIMEOUT"))
    : 0,
  workspace: null,
});

const wf = createWorkflow(developWorkflowDefinition, { adapter, overrides: null });

export const descriptor = buildDevelopDescriptor();
export const run = wf;
