/**
 * develop bundle entry — 小橘 🍊
 *
 * planner/coder/reviewer → cursor-agent (needs code editing)
 * tester/committer → hermes-agent (lightweight, no editing needed)
 */
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { optionalEnv } from "@uncaged/workflow-util";
import { buildDevelopDescriptor, developWorkflowDefinition } from "./src/index.js";

const cursorAdapter = createCursorAgent({
  command: optionalEnv("WORKFLOW_CURSOR_COMMAND") ?? "/home/azureuser/.local/bin/cursor-agent",
  model: optionalEnv("WORKFLOW_CURSOR_MODEL"),
  timeout: optionalEnv("WORKFLOW_CURSOR_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_CURSOR_TIMEOUT"))
    : 0,
  workspace: null,
});

const hermesAdapter = createHermesAgent({
  command: optionalEnv("WORKFLOW_HERMES_COMMAND") ?? "/home/azureuser/.local/bin/hermes",
  model: optionalEnv("WORKFLOW_HERMES_MODEL"),
  timeout: optionalEnv("WORKFLOW_HERMES_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_HERMES_TIMEOUT"))
    : null,
});

const wf = createWorkflow(developWorkflowDefinition, {
  adapter: cursorAdapter,
  overrides: {
    tester: hermesAdapter,
    committer: hermesAdapter,
  },
});

export const descriptor = buildDevelopDescriptor();
export const run = wf;
