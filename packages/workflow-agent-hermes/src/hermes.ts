import type { Store } from "@uncaged/json-cas";

import {
  type AgentContext,
  type AgentRunResult,
  buildRolePrompt,
  createAgent,
} from "@uncaged/workflow-agent-kit";

import { HermesAcpClient } from "./acp-client.js";
import { storeHermesSessionDetail } from "./session-detail.js";

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

/**
 * Agent CLI factory: parses argv, runs Hermes, extracts output, writes StepNode.
 *
 * A single ACP client is shared across run() and continue() calls so that
 * frontmatter retry loops keep the same Hermes session context.  The client
 * is closed once the agent process exits (via process.on("exit")).
 */
export function createHermesAgent(): () => Promise<void> {
  const client = new HermesAcpClient();

  // Ensure cleanup regardless of how the process exits.
  process.on("exit", () => {
    void client.close();
  });

  async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
    const fullPrompt = buildHermesPrompt(ctx);
    await client.connect(process.cwd());
    const { text, sessionId, messages } = await client.prompt(fullPrompt);
    const session = { session_id: sessionId, model: "", session_start: new Date().toISOString(), messages };
    const { detailHash } = await storeHermesSessionDetail(ctx.store, session);
    return { output: text, detailHash, sessionId };
  }

  async function continueHermes(
    _sessionId: string,
    message: string,
    store: Store,
  ): Promise<AgentRunResult> {
    // Client is already connected from runHermes — same ACP session,
    // so the agent sees the full conversation history (crucial for retries).
    const { text, sessionId, messages } = await client.prompt(message);
    const session = { session_id: sessionId, model: "", session_start: new Date().toISOString(), messages };
    const { detailHash } = await storeHermesSessionDetail(store, session);
    return { output: text, detailHash, sessionId };
  }

  const agentMain = createAgent({
    name: "hermes",
    run: runHermes,
    continue: continueHermes,
  });

  // Wrap to ensure ACP client is closed after agent completes,
  // so the hermes subprocess exits and bun can terminate.
  return async () => {
    try {
      await agentMain();
    } finally {
      await client.close();
    }
  };
}
