/**
 * solve-issue bundle entry — 小橘 🍊
 *
 * preparer + submitter → hermes agent
 * developer → workflow adapter (delegates to "develop" workflow)
 */
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { workflowAdapter } from "@uncaged/workflow-execute";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { env } from "@uncaged/workflow-util";
import { buildSolveIssueDescriptor, solveIssueWorkflowDefinition } from "./src/index.js";

const adapter = createHermesAgent({
  command: env("WORKFLOW_HERMES_COMMAND", "/home/azureuser/.local/bin/hermes"),
  model: env("WORKFLOW_HERMES_MODEL", "") || null,
  timeout: Number(env("WORKFLOW_HERMES_TIMEOUT", "0")) || null,
});

const wf = createWorkflow(solveIssueWorkflowDefinition, {
  adapter,
  overrides: {
    developer: workflowAdapter("develop"),
  },
});

export const descriptor = buildSolveIssueDescriptor();
export const run = wf;
