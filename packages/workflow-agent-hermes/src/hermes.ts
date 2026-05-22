import type { Store } from "@uncaged/json-cas";

import {
  type AgentContext,
  type AgentRunResult,
  buildRolePrompt,
  createAgent,
} from "@uncaged/workflow-agent-kit";

import { HermesAcpClient } from "./acp-client.js";
import { storeHermesRawOutput } from "./session-detail.js";

function buildHistorySummary(steps: AgentContext["steps"]): string {
  if (steps.length === 0) {
    return "";
  }

  const lines: string[] = ["## Previous Steps"];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) {
      continue;
    }
    lines.push("");
    lines.push(`### Step ${i + 1}: ${step.role}`);
    lines.push(`Output: ${JSON.stringify(step.output)}`);
    lines.push(`Agent: ${step.agent}`);
  }
  return lines.join("\n");
}

/** Assemble system prompt, task, and prior step outputs for Hermes. */
export function buildHermesPrompt(ctx: AgentContext): string {
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  const parts: string[] = [];
  if (ctx.outputFormatInstruction !== undefined && ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }
  parts.push(rolePrompt, "", "## Task", ctx.start.prompt);
  const historyBlock = buildHistorySummary(ctx.steps);
  if (historyBlock !== "") {
    parts.push("", historyBlock);
  }
  return parts.join("\n");
}

async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
  const fullPrompt = buildHermesPrompt(ctx);
  const client = new HermesAcpClient();
  try {
    await client.connect(process.cwd());
    const { text, sessionId } = await client.prompt(fullPrompt);
    const detailHash = await storeHermesRawOutput(ctx.store, text);
    return { output: text, detailHash, sessionId };
  } finally {
    await client.close();
  }
}

async function continueHermes(
  _sessionId: string,
  message: string,
  store: Store,
): Promise<AgentRunResult> {
  // ACP does not support resuming an external session; start a new session with the message as prompt
  const client = new HermesAcpClient();
  try {
    await client.connect(process.cwd());
    const { text, sessionId } = await client.prompt(message);
    const detailHash = await storeHermesRawOutput(store, text);
    return { output: text, detailHash, sessionId };
  } finally {
    await client.close();
  }
}

/** Agent CLI factory: parses argv, runs Hermes, extracts output, writes StepNode. */
export function createHermesAgent(): () => Promise<void> {
  return createAgent({
    name: "hermes",
    run: runHermes,
    continue: continueHermes,
  });
}
