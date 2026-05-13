/**
 * solve-issue bundle entry — 小橘 🍊
 *
 * preparer + submitter → hermes agent
 * developer → workflow-as-agent (delegates to "develop" workflow)
 */
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";
import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import { workflowAsAgent } from "@uncaged/workflow-execute";
import type { AdapterFn, AgentContext, AgentFnResult, ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import { createWorkflow } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { buildSolveIssueDescriptor, solveIssueWorkflowDefinition } from "./src/index.js";

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return null;
  }
  return value;
}

function wrapAgentAsAdapter(agentFn: (ctx: AgentContext) => Promise<AgentFnResult>): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    return async (ctx: ThreadContext, runtime: WorkflowRuntime): Promise<T> => {
      const agentCtx: AgentContext = { ...ctx, currentRole: { name: "agent", systemPrompt: prompt } };
      const result = await agentFn(agentCtx);
      const output = typeof result === "string" ? result : result.output;
      const contentHash = await putContentNodeWithRefs(runtime.cas, output, []);
      const extracted = await runtime.extract(schema as z.ZodType<Record<string, unknown>>, contentHash);
      return extracted.meta as T;
    };
  };
}

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
