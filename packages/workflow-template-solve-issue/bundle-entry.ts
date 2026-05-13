/**
 * solve-issue bundle entry — 小橘 🍊
 *
 * preparer + submitter → hermes agent
 * developer → workflow-as-agent (delegates to "develop" workflow)
 */
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { workflowAsAgent } from "@uncaged/workflow-execute";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { optionalEnv } from "@uncaged/workflow-util";
import { wrapAgentAsAdapter } from "@uncaged/workflow-util-agent";
import { buildSolveIssueDescriptor, solveIssueWorkflowDefinition } from "./src/index.js";

const hermesAgent = createHermesAgent({
  model: optionalEnv("WORKFLOW_HERMES_MODEL"),
  timeout: optionalEnv("WORKFLOW_HERMES_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_HERMES_TIMEOUT"))
    : null,
});

const developerAgent = workflowAsAgent("develop");

const adapter = wrapAgentAsAdapter(hermesAgent);
const developerAdapter = wrapAgentAsAdapter(developerAgent);

const wf = createWorkflow(solveIssueWorkflowDefinition, {
  adapter,
  overrides: {
    developer: developerAdapter,
  },
});

export const descriptor = buildSolveIssueDescriptor();
export const run = wf;
