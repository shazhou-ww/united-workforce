/**
 * solve-issue bundle entry — 小橘 🍊
 *
 * preparer + submitter → hermes agent
 * developer → workflow-as-agent (delegates to "develop" workflow)
 */
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { workflowAsAgent } from "@uncaged/workflow-execute";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { buildSolveIssueDescriptor, solveIssueWorkflowDefinition } from "./src/index.js";

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return null;
  }
  return value;
}

const hermesAgent = createHermesAgent({
  model: optionalEnv("WORKFLOW_HERMES_MODEL"),
  timeout: optionalEnv("WORKFLOW_HERMES_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_HERMES_TIMEOUT"))
    : null,
});

const developerAgent = workflowAsAgent("develop");

const wf = createWorkflow(solveIssueWorkflowDefinition, {
  agent: hermesAgent,
  overrides: {
    developer: developerAgent,
  },
});

export const descriptor = buildSolveIssueDescriptor();
export const run = wf;
