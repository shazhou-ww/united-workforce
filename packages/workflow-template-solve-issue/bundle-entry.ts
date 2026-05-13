/**
 * solve-issue bundle entry — 小橘 🍊
 *
 * preparer + submitter → hermes agent
 * developer → workflow adapter (delegates to "develop" workflow)
 */
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { workflowAdapter } from "@uncaged/workflow-execute";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { optionalEnv } from "@uncaged/workflow-util";
import { buildSolveIssueDescriptor, solveIssueWorkflowDefinition } from "./src/index.js";

const adapter = createHermesAgent({
  model: optionalEnv("WORKFLOW_HERMES_MODEL"),
  timeout: optionalEnv("WORKFLOW_HERMES_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_HERMES_TIMEOUT"))
    : null,
});

const wf = createWorkflow(solveIssueWorkflowDefinition, {
  adapter,
  overrides: {
    developer: workflowAdapter("develop"),
  },
});

export const descriptor = buildSolveIssueDescriptor();
export const run = wf;
