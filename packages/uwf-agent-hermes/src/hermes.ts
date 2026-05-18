import { spawn } from "node:child_process";

import { type AgentContext, type AgentRunResult, createAgent } from "@uncaged/uwf-agent-kit";

import {
  loadHermesSession,
  parseSessionIdFromStdout,
  storeHermesRawOutput,
  storeHermesSessionDetail,
} from "./session-detail.js";

const HERMES_COMMAND = "hermes";
const HERMES_MAX_TURNS = 90;

function buildHistorySummary(history: AgentContext["history"]): string {
  if (history.length === 0) {
    return "";
  }

  const lines: string[] = ["## Previous Steps"];
  for (let i = 0; i < history.length; i++) {
    const step = history[i];
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
  const parts: string[] = [ctx.systemPrompt, "", "## Task", ctx.prompt];
  const historyBlock = buildHistorySummary(ctx.history);
  if (historyBlock !== "") {
    parts.push("", historyBlock);
  }
  return parts.join("\n");
}

function spawnHermesChat(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "chat",
      "-q",
      prompt,
      "--yolo",
      "--max-turns",
      String(HERMES_MAX_TURNS),
      "--quiet",
    ];
    const child = spawn(HERMES_COMMAND, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      reject(new Error(`hermes spawn failed: ${message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim() !== "" ? ` stderr=${stderr.trim()}` : "";
      reject(new Error(`hermes exited with code ${code ?? "null"}${detail}`));
    });
  });
}

async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
  const fullPrompt = buildHermesPrompt(ctx);
  const rawOutput = await spawnHermesChat(fullPrompt);
  const { store } = ctx;

  const sessionId = parseSessionIdFromStdout(rawOutput);
  if (sessionId !== null) {
    const session = await loadHermesSession(sessionId);
    if (session !== null) {
      const { detailHash, output } = await storeHermesSessionDetail(store, session);
      return { output, detailHash };
    }
  }

  const detailHash = await storeHermesRawOutput(store, rawOutput);
  return { output: rawOutput, detailHash };
}

/** Agent CLI factory: parses argv, runs Hermes, extracts output, writes StepNode. */
export function createHermesAgent(): () => Promise<void> {
  return createAgent({
    name: "hermes",
    run: runHermes,
  });
}
