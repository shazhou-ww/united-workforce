import { spawn } from "node:child_process";
import type { Store } from "@uncaged/json-cas";

import {
  type AgentContext,
  type AgentRunResult,
  buildRolePrompt,
  createAgent,
} from "@uncaged/workflow-agent-kit";

import {
  loadHermesSession,
  parseSessionIdFromStdout,
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

function spawnHermes(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
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

function spawnHermesChat(prompt: string): Promise<{ stdout: string; stderr: string }> {
  return spawnHermes([
    "chat",
    "-q",
    prompt,
    "--yolo",
    "--max-turns",
    String(HERMES_MAX_TURNS),
    "--quiet",
  ]);
}

function spawnHermesResume(
  sessionId: string,
  message: string,
): Promise<{ stdout: string; stderr: string }> {
  return spawnHermes([
    "chat",
    "--resume",
    sessionId,
    "-q",
    message,
    "--yolo",
    "--max-turns",
    String(HERMES_MAX_TURNS),
    "--quiet",
  ]);
}

function parseSessionId(stdout: string, stderr: string): string {
  const sessionId = parseSessionIdFromStdout(stderr) ?? parseSessionIdFromStdout(stdout);
  if (sessionId === null) {
    throw new Error(
      "Failed to parse session_id from hermes output.\n" +
        `stderr (first 200 chars): ${stderr.slice(0, 200)}\n` +
        `stdout (first 200 chars): ${stdout.slice(0, 200)}`,
    );
  }
  return sessionId;
}

async function buildResultFromSession(sessionId: string, store: Store): Promise<AgentRunResult> {
  const session = await loadHermesSession(sessionId);
  if (session === null) {
    throw new Error(`Failed to load hermes session file for session_id: ${sessionId}`);
  }
  const { detailHash, output } = await storeHermesSessionDetail(store, session);
  return { output, detailHash, sessionId };
}

async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
  const fullPrompt = buildHermesPrompt(ctx);
  const { stdout, stderr } = await spawnHermesChat(fullPrompt);
  const sessionId = parseSessionId(stdout, stderr);
  return buildResultFromSession(sessionId, ctx.store);
}

async function continueHermes(
  sessionId: string,
  message: string,
  store: Store,
): Promise<AgentRunResult> {
  const { stdout, stderr } = await spawnHermesResume(sessionId, message);
  // Resume may return a new session_id
  const newSessionId = parseSessionIdFromStdout(stderr) ?? parseSessionIdFromStdout(stdout);
  const resolvedId = newSessionId ?? sessionId;
  return buildResultFromSession(resolvedId, store);
}

/** Agent CLI factory: parses argv, runs Hermes, extracts output, writes StepNode. */
export function createHermesAgent(): () => Promise<void> {
  return createAgent({
    name: "hermes",
    run: runHermes,
    continue: continueHermes,
  });
}
