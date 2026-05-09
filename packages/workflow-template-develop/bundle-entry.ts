/**
 * develop bundle entry — 小橘 🍊
 */
import { buildDevelopDescriptor, developWorkflowDefinition } from "./src/index.js";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { createExtract } from "@uncaged/workflow-execute";
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";

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

const provider = {
  baseUrl: optionalEnv("WORKFLOW_LLM_BASE_URL") ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: requireEnv("WORKFLOW_LLM_API_KEY"),
  model: optionalEnv("WORKFLOW_LLM_MODEL") ?? "qwen-plus",
};

const agent = createHermesAgent({
  model: optionalEnv("WORKFLOW_HERMES_MODEL"),
  timeout: optionalEnv("WORKFLOW_HERMES_TIMEOUT")
    ? Number(optionalEnv("WORKFLOW_HERMES_TIMEOUT"))
    : null,
});

const extract = createExtract(provider);

const wf = createWorkflow(developWorkflowDefinition, { agent }, extract);

export const descriptor = buildDevelopDescriptor();
export const run = wf.run;
