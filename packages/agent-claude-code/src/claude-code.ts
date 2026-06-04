import { spawn } from "node:child_process";
import type { Store } from "@ocas/core";
import type { Usage } from "@united-workforce/protocol";
import { createLogger } from "@united-workforce/util";
import {
  type AgentContext,
  type AgentRunResult,
  buildContinuationPrompt,
  buildRolePrompt,
  createAgent,
  getCachedSessionId,
  setCachedSessionId,
} from "@united-workforce/util-agent";

import { parseClaudeCodeStreamOutput, storeClaudeCodeDetail } from "./session-detail.js";

const log = createLogger({ sink: { kind: "stderr" } });

const CLAUDE_COMMAND = "claude";
const CLAUDE_MAX_TURNS = 90;

/** Assemble system prompt, task, and prior step outputs for Claude Code. */
export function buildClaudeCodePrompt(ctx: AgentContext): string {
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  const parts: string[] = [];
  if (ctx.outputFormatInstruction !== undefined && ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }
  parts.push(rolePrompt, "", "## Task", ctx.start.prompt);

  if (!ctx.isFirstVisit) {
    // Re-entry (session will be resumed): show only steps since last visit, meta only
    parts.push("", buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt));
  } else if (ctx.steps.length > 0) {
    // First visit: show all steps with content for recent ones
    parts.push(
      "",
      buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt, {
        includeContent: true,
        quota: 32000,
      }),
    );
  } else {
    parts.push("", "## Current Instruction", "", ctx.edgePrompt);
  }

  return parts.join("\n");
}

function spawnClaude(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
        resolve({ stdout, stderr, exitCode: code });
        return;
      }
      const detail = stderr.trim() !== "" ? ` stderr=${stderr.trim()}` : "";
      reject(new Error(`claude exited with code ${code ?? "null"}${detail}`));
    });
  });
}

function spawnClaudeRun(
  prompt: string,
  model: string | null,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(CLAUDE_MAX_TURNS),
  ];
  if (model !== null) {
    args.push("--model", model);
  }
  return spawnClaude(args);
}

function spawnClaudeResume(
  sessionId: string,
  message: string,
  model: string | null,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const args = [
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
  ];
  if (model !== null) {
    args.push("--model", model);
  }
  return spawnClaude(args);
}

async function processClaudeOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  store: Store,
  assembledPrompt: string,
): Promise<AgentRunResult> {
  const parsed = parseClaudeCodeStreamOutput(stdout);

  if (parsed !== null) {
    const { detailHash, output, sessionId } = await storeClaudeCodeDetail(store, parsed);

    // Log incomplete results for visibility
    if (parsed.subtype === "incomplete") {
      log(
        "7NQW8R4P",
        `Claude Code exited with incomplete output (no result line). Exit code: ${exitCode ?? "null"}, stderr: ${stderr.slice(0, 200)}`,
      );
    }

    const usage: Usage = {
      turns: parsed.numTurns,
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
      duration: Math.round(parsed.durationMs / 1000),
    };

    return { output, detailHash, sessionId, assembledPrompt, usage };
  }

  // Truly unparseable output - provide enhanced error message
  const exitInfo = exitCode !== null && exitCode !== 0 ? `Exit code: ${exitCode}\n` : "";
  const stderrInfo = stderr.trim() !== "" ? `Stderr: ${stderr.slice(0, 200)}\n` : "";
  const stdoutSnippet = stdout.slice(0, 200);

  throw new Error(
    `Claude Code exited without producing parseable output.\n${exitInfo}${stderrInfo}Stdout (first 200 chars): ${stdoutSnippet}`,
  );
}

async function runClaudeCode(ctx: AgentContext, model: string | null): Promise<AgentRunResult> {
  const fullPrompt = buildClaudeCodePrompt(ctx);

  log("K7R2M4N8", `prompt for role=${ctx.role} (length=${fullPrompt.length}):\n${fullPrompt}`);

  // Try resuming a cached session for re-entry scenarios (e.g. reviewer reject → developer re-entry).
  if (!ctx.isFirstVisit) {
    const cachedSessionId = await getCachedSessionId(
      "claude-code",
      ctx.threadId,
      ctx.role,
      ctx.storageRoot,
    );
    if (cachedSessionId !== null) {
      try {
        const { stdout, stderr, exitCode } = await spawnClaudeResume(
          cachedSessionId,
          fullPrompt,
          model,
        );
        const result = await processClaudeOutput(stdout, stderr, exitCode, ctx.store, fullPrompt);
        if (result.sessionId !== undefined && result.sessionId !== "") {
          await setCachedSessionId(
            "claude-code",
            ctx.threadId,
            ctx.role,
            result.sessionId,
            ctx.storageRoot,
          );
        }
        return result;
      } catch (err) {
        log(
          "5VKR8N3Q",
          `resume failed for session ${cachedSessionId}, falling back to fresh run: ${err}`,
        );
      }
    }
  }

  const { stdout, stderr, exitCode } = await spawnClaudeRun(fullPrompt, model);
  const result = await processClaudeOutput(stdout, stderr, exitCode, ctx.store, fullPrompt);
  if (result.sessionId !== undefined && result.sessionId !== "") {
    await setCachedSessionId(
      "claude-code",
      ctx.threadId,
      ctx.role,
      result.sessionId,
      ctx.storageRoot,
    );
  }
  return result;
}

async function continueClaudeCode(
  sessionId: string,
  message: string,
  store: Store,
  model: string | null,
): Promise<AgentRunResult> {
  const { stdout, stderr, exitCode } = await spawnClaudeResume(sessionId, message, model);
  return processClaudeOutput(stdout, stderr, exitCode, store, "");
}

/** Agent CLI factory: parses argv, runs Claude Code, extracts output, writes StepNode. */
export function createClaudeCodeAgent(model: string | null): () => Promise<void> {
  return createAgent({
    name: "claude-code",
    run: (ctx) => runClaudeCode(ctx, model),
    continue: (sessionId, message, store) => continueClaudeCode(sessionId, message, store, model),
  });
}
