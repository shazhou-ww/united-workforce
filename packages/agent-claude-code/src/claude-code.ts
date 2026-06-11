import { spawn } from "node:child_process";
import type { Store } from "@ocas/core";
import type { Usage } from "@united-workforce/protocol";
import { createLogger } from "@united-workforce/util";
import {
  type AgentContext,
  type AgentRunResult,
  buildContinuationPrompt,
  buildFrontmatterRetryPrompt,
  buildRolePrompt,
  buildSuspendOutput,
  buildThreadProgress,
  createAgent,
  getCachedSessionId,
  setCachedSessionId,
} from "@united-workforce/util-agent";

import { parseClaudeCodeStreamOutput, storeClaudeCodeDetail } from "./session-detail.js";

const log = createLogger({ sink: { kind: "stderr" } });

const CLAUDE_COMMAND = "claude";
const CLAUDE_MAX_TURNS = 90;

const STDERR_TRUNCATE_LIMIT = 500;

const NOT_LOGGED_IN_MESSAGE = "Claude Code is not logged in. Run `claude login` first.";
const API_KEY_ERROR_MESSAGE = "Claude Code API key error. Check your API key configuration.";

const API_KEY_PATTERNS: readonly RegExp[] = [
  /invalid api key/i,
  /ANTHROPIC_API_KEY/i,
  /authentication/i,
  /unauthorized/i,
];

/**
 * Pure helper: map a captured `claude` subprocess failure (`exitCode`, `stderr`)
 * to an actionable, user-facing error message. Recognises common patterns
 * (`Not logged in`, API key errors) and falls back to a generic
 * `claude exited with code <n>: <truncated stderr>` for unknown failures.
 *
 * Pure / no I/O — safe to unit test without spawning a subprocess.
 */
export function mapClaudeError(exitCode: number | null, stderr: string): string {
  const trimmed = stderr.trim();
  const codeText = exitCode === null ? "null" : String(exitCode);

  if (/not logged in/i.test(trimmed)) {
    return `claude exited with code ${codeText}: ${NOT_LOGGED_IN_MESSAGE}`;
  }

  for (const pattern of API_KEY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `claude exited with code ${codeText}: ${API_KEY_ERROR_MESSAGE}`;
    }
  }

  if (trimmed === "") {
    return `claude exited with code ${codeText}`;
  }

  const snippet =
    trimmed.length > STDERR_TRUNCATE_LIMIT
      ? `${trimmed.slice(0, STDERR_TRUNCATE_LIMIT)}…`
      : trimmed;
  return `claude exited with code ${codeText}: ${snippet}`;
}

/** Assemble system prompt, task, and prior step outputs for Claude Code. */
export function buildClaudeCodePrompt(ctx: AgentContext): string {
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  const parts: string[] = [];
  if (ctx.outputFormatInstruction !== undefined && ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }

  // Inject thread progress so the agent knows step count and role visit count
  parts.push(buildThreadProgress(ctx.steps, ctx.role, ctx.threadId), "");

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
  cwd: string = process.cwd(),
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_COMMAND, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
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
      reject(new Error(mapClaudeError(code, stderr)));
    });
  });
}

function spawnClaudeRun(
  prompt: string,
  model: string | null,
  cwd: string,
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
  return spawnClaude(args, cwd);
}

function spawnClaudeResume(
  sessionId: string,
  message: string,
  model: string | null,
  cwd: string,
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
  return spawnClaude(args, cwd);
}

export async function processClaudeOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  store: Store,
  assembledPrompt: string,
  wallClockMs: number,
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

    // CC's result line reports last-turn-only stats for num_turns/duration/usage.
    // Use our own parsed turn count and wall-clock time instead.
    // Token counts from the result line are still last-turn-only — there is no
    // cumulative source in CC's streaming output, so we report what we have.
    const usage: Usage = {
      turns: parsed.numTurns,
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
      duration: Math.round(wallClockMs / 1000),
    };

    // Max-turns is a resource limit, not a failure. Yield `$SUSPEND` instead of
    // throwing so the step is written to CAS (turns + usage preserved) and the
    // caller can resume the same role.
    if (parsed.subtype === "error_max_turns") {
      log("R9KQ2WN7", `Claude Code hit max turns (${CLAUDE_MAX_TURNS}) — yielding $SUSPEND`);
      return {
        output: buildSuspendOutput(`max turns (${CLAUDE_MAX_TURNS}) reached`),
        detailHash,
        sessionId,
        assembledPrompt,
        usage,
      };
    }

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
  const cwd = ctx.start.cwd !== "" ? ctx.start.cwd : process.cwd();

  log("K7R2M4N8", `prompt for role=${ctx.role} length=${fullPrompt.length}`);
  if (process.env.UWF_DEBUG === "1" || process.env.UWF_DEBUG === "true") {
    log("D8X3M4P7", `prompt body for role=${ctx.role}:\n${fullPrompt}`);
  }

  // Try resuming a cached session.  This covers both normal re-entry
  // (e.g. reviewer reject → developer re-entry) AND the case where a
  // previous run completed but frontmatter validation failed — the step
  // was never written to CAS so isFirstVisit is still true, but the
  // session cache holds a valid session we should resume.
  {
    const cachedSessionId = await getCachedSessionId(
      "claude-code",
      ctx.threadId,
      ctx.role,
      ctx.storageRoot,
    );
    if (cachedSessionId !== null) {
      // isFirstVisit + cache hit = previous run completed but frontmatter
      // validation failed.  The session already has full context — send a
      // minimal correction prompt instead of the full initial prompt.
      const resumePrompt = ctx.isFirstVisit
        ? buildFrontmatterRetryPrompt(ctx.outputFormatInstruction)
        : fullPrompt;

      try {
        const startMs = Date.now();
        const { stdout, stderr, exitCode } = await spawnClaudeResume(
          cachedSessionId,
          resumePrompt,
          model,
          cwd,
        );
        const result = await processClaudeOutput(
          stdout,
          stderr,
          exitCode,
          ctx.store,
          resumePrompt,
          Date.now() - startMs, // wall-clock elapsed, not CC result line duration
        );
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

  const startMs = Date.now();
  const { stdout, stderr, exitCode } = await spawnClaudeRun(fullPrompt, model, cwd);
  const result = await processClaudeOutput(
    stdout,
    stderr,
    exitCode,
    ctx.store,
    fullPrompt,
    Date.now() - startMs, // wall-clock elapsed, not CC result line duration
  );
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
  const startMs = Date.now();
  const cwd = process.cwd();
  const { stdout, stderr, exitCode } = await spawnClaudeResume(sessionId, message, model, cwd);
  return processClaudeOutput(stdout, stderr, exitCode, store, "", Date.now() - startMs); // wall-clock elapsed, not CC result line duration
}

/** Agent CLI factory: parses argv, runs Claude Code, extracts output, writes StepNode. */
export function createClaudeCodeAgent(model: string | null): () => Promise<void> {
  return createAgent({
    name: "claude-code",
    run: (ctx) => runClaudeCode(ctx, model),
    continue: (sessionId, message, store) => continueClaudeCode(sessionId, message, store, model),
    fork: null,
    cleanup: null,
  });
}
