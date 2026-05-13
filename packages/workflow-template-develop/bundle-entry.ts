/**
 * develop bundle entry — 小橘 🍊
 *
 * All roles use cursor-agent with workspace auto-extracted from context.
 */
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";
import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type { AdapterFn, AgentContext, AgentFnResult, ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import { createWorkflow } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { buildDevelopDescriptor, developWorkflowDefinition } from "./src/index.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return null;
  }
  return value;
}

const llmProvider = {
  baseUrl:
    optionalEnv("WORKFLOW_LLM_BASE_URL") ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: requireEnv("WORKFLOW_LLM_API_KEY"),
  model: optionalEnv("WORKFLOW_LLM_MODEL") ?? "qwen-plus",
};

const agent = createCursorAgent({
  command: requireEnv("WORKFLOW_CURSOR_COMMAND"),
  model: optionalEnv("WORKFLOW_CURSOR_MODEL"),
  timeout: optionalEnv("WORKFLOW_CURSOR_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_CURSOR_TIMEOUT"))
    : 0,
  workspace: null,
  llmProvider,
});

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

const adapter = wrapAgentAsAdapter(agent);

const wf = createWorkflow(developWorkflowDefinition, { adapter, overrides: null });

export const descriptor = buildDevelopDescriptor();
export const run = wf;
