/**
 * develop bundle entry — 小橘 🍊
 *
 * planner/coder/reviewer → cursor-agent (needs code editing)
 * tester/committer → hermes-agent (lightweight, no editing needed)
 */
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { env } from "@uncaged/workflow-util";
import { buildDevelopDescriptor, developWorkflowDefinition } from "./src/index.js";

const cursorAdapter = createCursorAgent({
  command: env("WORKFLOW_CURSOR_COMMAND", "/home/azureuser/.local/bin/cursor-agent"),
  model: env("WORKFLOW_CURSOR_MODEL", "auto"),
  timeout: Number(env("WORKFLOW_CURSOR_TIMEOUT", "0")),
  workspace: null,
});

const hermesAdapter = createHermesAgent({
  command: env("WORKFLOW_HERMES_COMMAND", "/home/azureuser/.local/bin/hermes"),
  model: env("WORKFLOW_HERMES_MODEL", "") || null,
  timeout: Number(env("WORKFLOW_HERMES_TIMEOUT", "0")) || null,
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
