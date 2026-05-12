/**
 * develop bundle entry — 小橘 🍊
 *
 * All roles use cursor-agent with workspace auto-extracted from context.
 */
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";
import { createWorkflow } from "@uncaged/workflow-runtime";
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
  command: optionalEnv("WORKFLOW_CURSOR_COMMAND"),
  model: optionalEnv("WORKFLOW_CURSOR_MODEL"),
  timeout: optionalEnv("WORKFLOW_CURSOR_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_CURSOR_TIMEOUT"))
    : 0,
  workspace: null,
  llmProvider,
});

const wf = createWorkflow(developWorkflowDefinition, { agent, overrides: null });

export const descriptor = buildDevelopDescriptor();
export const run = wf;
