import { spawn } from "node:child_process";
import type { Store } from "@uncaged/json-cas";

import { createLogger } from "@uncaged/workflow-util";

import {
  type AgentContext,
  type AgentRunResult,
  buildRolePrompt,
  createAgent,
  getCachedSessionId,
  setCachedSessionId,
} from "@uncaged/workflow-agent-kit";

import { parseClaudeCodeStreamOutput, storeClaudeCodeDetail } from "./session-detail.js";

const log = createLogger({ sink: { kind: "stderr" } });

const CLAUDE_COMMAND = "claude";
const CLAUDE_MAX_TURNS = 90;

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

/** Assemble system prompt, task, and prior step outputs for Claude Code. */
export function buildClaudeCodePrompt(ctx: AgentContext): string {
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

function spawnClaude(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_COMMAND, args, {
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
      reject(new Error(`claude spawn failed: ${message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() !== "" ? ` stderr=${stderr.trim()}` : "";
      reject(new Error(`claude exited with code ${code ?? "null"}${detail}`));
    });
  });
}

function spawnClaudeRun(prompt: string): Promise<{ stdout: string; stderr: string }> {
  return spawnClaude([
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(CLAUDE_MAX_TURNS),
  ]);
}

function spawnClaudeResume(
  sessionId: string,
  message: string,
): Promise<{ stdout: string; stderr: string }> {
  return spawnClaude([
    "-p",
    message,
    "--resume",
    sessionId,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(CLAUDE_MAX_TURNS),
  ]);
}

async function processClaudeOutput(stdout: string, store: Store): Promise<AgentRunResult> {
  const parsed = parseClaudeCodeStreamOutput(stdout);

  if (parsed !== null) {
    const { detailHash, output, sessionId } = await storeClaudeCodeDetail(store, parsed);
    return { output, detailHash, sessionId };
  }

  throw new Error(
    `Claude Code returned unparseable output (first 200 chars): ${stdout.slice(0, 200)}`,
  );
}

async function runClaudeCode(ctx: AgentContext): Promise<AgentRunResult> {
  const fullPrompt = buildClaudeCodePrompt(ctx);

  // Try resuming a cached session for re-entry scenarios (e.g. reviewer reject → developer re-entry).
  if (!ctx.isFirstVisit) {
    const cachedSessionId = await getCachedSessionId(ctx.threadId, ctx.role);
    if (cachedSessionId !== null) {
      try {
        const { stdout } = await spawnClaudeResume(cachedSessionId, fullPrompt);
        const result = await processClaudeOutput(stdout, ctx.store);
        if (result.sessionId !== undefined && result.sessionId !== "") {
          await setCachedSessionId(ctx.threadId, ctx.role, result.sessionId);
        }
        return result;
      } catch (err) {
        log("5VKR8N3Q", "resume failed for session %s, falling back to fresh run: %s", cachedSessionId, err);
      }
    }
  }

  const { stdout } = await spawnClaudeRun(fullPrompt);
  const result = await processClaudeOutput(stdout, ctx.store);
  if (result.sessionId !== undefined && result.sessionId !== "") {
    await setCachedSessionId(ctx.threadId, ctx.role, result.sessionId);
  }
  return result;
}

async function continueClaudeCode(
  sessionId: string,
  message: string,
  store: Store,
): Promise<AgentRunResult> {
  const { stdout } = await spawnClaudeResume(sessionId, message);
  return processClaudeOutput(stdout, store);
}

/** Agent CLI factory: parses argv, runs Claude Code, extracts output, writes StepNode. */
export function createClaudeCodeAgent(): () => Promise<void> {
  return createAgent({
    name: "claude-code",
    run: runClaudeCode,
    continue: continueClaudeCode,
  });
}
