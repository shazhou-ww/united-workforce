import { createExtract } from "./packages/workflow/src/index.js";
import { createHermesAgent } from "./packages/workflow-agent-hermes/src/index.js";
import {
  buildSolveIssueDescriptor,
  createSolveIssueRun,
} from "./packages/workflow-template-solve-issue/src/index.js";

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
  baseUrl:
    optionalEnv("WORKFLOW_LLM_BASE_URL") ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
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

export const descriptor = buildSolveIssueDescriptor();
export const run = createSolveIssueRun({ agent }, extract);
