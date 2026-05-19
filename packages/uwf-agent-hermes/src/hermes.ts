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
  const systemPrompt = roleDef?.systemPrompt ?? "";
  const parts: string[] = [];
  if (ctx.outputFormatInstruction !== undefined && ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }
  parts.push(systemPrompt, "", "## Task", ctx.start.prompt);
  const historyBlock = buildHistorySummary(ctx.steps);
  if (historyBlock !== "") {
    parts.push("", historyBlock);
  }
  return parts.join("\n");
}

function spawnHermesChat(prompt: string): Promise<{ stdout: string; stderr: string }> {
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
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() !== "" ? ` stderr=${stderr.trim()}` : "";
      reject(new Error(`hermes exited with code ${code ?? "null"}${detail}`));
    });
  });
}

async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
  const fullPrompt = buildHermesPrompt(ctx);
  const { stdout, stderr } = await spawnHermesChat(fullPrompt);
  const { store } = ctx;

  // --quiet mode: session_id may be on stdout or stderr
  const sessionId = parseSessionIdFromStdout(stderr) ?? parseSessionIdFromStdout(stdout);
  if (sessionId !== null) {
    const session = await loadHermesSession(sessionId);
    if (session !== null) {
      const { detailHash, output } = await storeHermesSessionDetail(store, session);
      return { output, detailHash };
    }
  }

  const detailHash = await storeHermesRawOutput(store, stdout);
  return { output: stdout, detailHash };
}

/** Agent CLI factory: parses argv, runs Hermes, extracts output, writes StepNode. */
export function createHermesAgent(): () => Promise<void> {
  return createAgent({
    name: "hermes",
    run: runHermes,
  });
}
