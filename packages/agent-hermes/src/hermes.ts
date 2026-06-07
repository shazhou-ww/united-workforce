import type { Store } from "@ocas/core";
import type { Usage } from "@united-workforce/protocol";
import { createLogger } from "@united-workforce/util";
import {
  type AgentContext,
  type AgentRunResult,
  buildContinuationPrompt,
  buildFrontmatterRetryPrompt,
  buildRolePrompt,
  buildThreadProgress,
  createAgent,
} from "@united-workforce/util-agent";
import type { AcpUsage } from "./acp-client.js";
import { HermesAcpClient } from "./acp-client.js";
import { getCachedSessionId, setCachedSessionId } from "./session-cache.js";
import { loadHermesSession, storeHermesSessionDetail } from "./session-detail.js";
import type { HermesSessionJson } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

/** Snapshot of session metrics taken before and after a prompt call. */
type TurnsSnapshot = {
  turns: number;
};

const ZERO_TURNS: TurnsSnapshot = { turns: 0 };

/** Extract assistant turn count from a session. Returns zero for null sessions. */
export function snapshotTurns(session: HermesSessionJson | null): TurnsSnapshot {
  if (session === null) {
    return ZERO_TURNS;
  }
  return {
    turns: session.messages.filter((m) => m.role === "assistant").length,
  };
}

/**
 * Build Usage from ACP token data + DB turn delta.
 * Tokens come from ACP PromptResponse (synchronous, accurate).
 * Turns come from DB before/after snapshots (may have WAL lag, but acceptable).
 */
export function buildUsage(
  acpUsage: AcpUsage | null,
  beforeTurns: TurnsSnapshot,
  afterTurns: TurnsSnapshot,
  durationSec: number,
): Usage {
  return {
    turns: Math.max(0, afterTurns.turns - beforeTurns.turns) || 1,
    inputTokens: acpUsage?.inputTokens ?? 0,
    outputTokens: acpUsage?.outputTokens ?? 0,
    duration: Math.round(durationSec),
  };
}

/** Assemble system prompt, task, and prior step outputs for Hermes. */
export function buildHermesPrompt(ctx: AgentContext): string {
  const parts: string[] = [];

  if (ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }

  // Inject thread progress so the agent knows step count and role visit count
  parts.push(buildThreadProgress(ctx.steps, ctx.role), "");

  if (!ctx.isFirstVisit) {
    // Re-entry: show only steps since last visit, meta only
    parts.push(buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt));
    return parts.join("\n");
  }

  // First visit: show initial context with content for recent steps
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  parts.push(rolePrompt, "", "## Task", ctx.start.prompt);

  // Add history with content (last 2-3 steps within quota)
  if (ctx.steps.length > 0) {
    parts.push(
      "",
      buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt, {
        includeContent: true,
        quota: 32000, // Use THREAD_READ_DEFAULT_QUOTA equivalent
      }),
    );
  } else {
    parts.push("", "## Moderator Instruction", "", ctx.edgePrompt);
  }

  return parts.join("\n");
}

async function storePromptResult(store: Store, sessionId: string): Promise<{ detailHash: string }> {
  const session = await loadHermesSession(sessionId);
  if (session === null) {
    throw new Error(`Hermes session file not found: ${sessionId}`);
  }
  return storeHermesSessionDetail(store, session);
}

type PromptAttempt = {
  useContinuation: boolean;
  resumed: boolean;
  /** True when resuming after a frontmatter-only failure (isFirstVisit + cache hit). */
  frontmatterRetry: boolean;
};

async function prepareSession(
  client: HermesAcpClient,
  ctx: AgentContext,
  cwd: string,
  resumeDisabled: boolean,
): Promise<PromptAttempt> {
  if (resumeDisabled) {
    await client.connect(cwd);
    return { useContinuation: false, resumed: false, frontmatterRetry: false };
  }

  // Check session cache regardless of isFirstVisit.  A previous run may
  // have completed and cached its session but failed frontmatter
  // validation — the step never got written to CAS so isFirstVisit is
  // still true, yet we should resume the existing session.
  const cachedSessionId = await getCachedSessionId(ctx.threadId, ctx.role, ctx.storageRoot);
  if (cachedSessionId === null) {
    log("6RWK3N8Q", `no cached session for ${ctx.threadId}:${ctx.role}, starting new session`);
    await client.connect(cwd);
    return { useContinuation: false, resumed: false, frontmatterRetry: false };
  }

  try {
    await client.resume(cachedSessionId, cwd);
    log("9MHT4V2P", `resumed hermes session ${cachedSessionId} for ${ctx.threadId}:${ctx.role}`);
    return {
      useContinuation: !ctx.isFirstVisit,
      resumed: true,
      frontmatterRetry: ctx.isFirstVisit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("3XPN7K4W", `session resume failed, falling back to new session: ${message}`);
    await client.close();
    await client.connect(cwd);
    return { useContinuation: false, resumed: false, frontmatterRetry: false };
  }
}

/**
 * Agent CLI factory: parses argv, runs Hermes, extracts output, writes StepNode.
 *
 * A single ACP client is shared across run() and continue() calls so that
 * frontmatter retry loops keep the same Hermes session context.  The client
 * is closed once the agent process exits (via process.on("exit")).
 */
export function createHermesAgent(resumeDisabled: boolean): () => Promise<void> {
  const client = new HermesAcpClient();

  // Ensure cleanup regardless of how the process exits.
  process.on("exit", () => {
    void client.close();
  });

  async function runPrompt(
    ctx: AgentContext,
    useContinuation: boolean,
    beforeTurns: TurnsSnapshot,
    frontmatterRetry: boolean,
  ): Promise<AgentRunResult> {
    // Frontmatter retry: session has full context, just re-output the format.
    const fullPrompt = frontmatterRetry
      ? buildFrontmatterRetryPrompt(ctx.outputFormatInstruction)
      : buildHermesPrompt(useContinuation ? ctx : { ...ctx, isFirstVisit: true });
    const startMs = Date.now();
    const { text, sessionId, usage: acpUsage } = await client.prompt(fullPrompt);
    const durationSec = (Date.now() - startMs) / 1000;
    const { detailHash } = await storePromptResult(ctx.store, sessionId);

    if (!resumeDisabled) {
      await setCachedSessionId(ctx.threadId, ctx.role, sessionId, ctx.storageRoot);
    }

    // Turns from DB (may lag slightly due to WAL, but acceptable)
    const afterSession = await loadHermesSession(sessionId);
    const afterTurns = snapshotTurns(afterSession);
    const usage = buildUsage(acpUsage, beforeTurns, afterTurns, durationSec);

    return { output: text, detailHash, sessionId, assembledPrompt: fullPrompt, usage };
  }

  async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
    const cwd = process.cwd();
    const attempt = await prepareSession(client, ctx, cwd, resumeDisabled);

    // Snapshot before prompt: for resumed sessions, captures cumulative state
    // so we can compute the turn delta. For new sessions, this is ZERO_TURNS.
    const currentSessionId = client.getSessionId();
    const beforeSession =
      attempt.resumed && currentSessionId !== null
        ? await loadHermesSession(currentSessionId)
        : null;
    const beforeTurns = snapshotTurns(beforeSession);

    try {
      return await runPrompt(ctx, attempt.useContinuation, beforeTurns, attempt.frontmatterRetry);
    } catch (error) {
      if (!attempt.resumed) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      log("8FQW2R6N", `continuation prompt failed, retrying with initial prompt: ${message}`);
      await client.close();
      await client.connect(cwd);
      // Fresh session after retry — reset snapshot to zero
      return runPrompt(ctx, false, ZERO_TURNS, false);
    }
  }

  async function continueHermes(
    _sessionId: string,
    message: string,
    store: Store,
  ): Promise<AgentRunResult> {
    // Client is already connected from runHermes — same ACP session,
    // so the agent sees the full conversation history (crucial for retries).
    // Snapshot turns before the continuation prompt for delta computation.
    const currentSessionId = client.getSessionId();
    const beforeSession =
      currentSessionId !== null ? await loadHermesSession(currentSessionId) : null;
    const beforeTurns = snapshotTurns(beforeSession);

    const startMs = Date.now();
    const { text, sessionId, usage: acpUsage } = await client.prompt(message);
    const durationSec = (Date.now() - startMs) / 1000;
    const { detailHash } = await storePromptResult(store, sessionId);

    const afterSession = await loadHermesSession(sessionId);
    const afterTurns = snapshotTurns(afterSession);
    const usage = buildUsage(acpUsage, beforeTurns, afterTurns, durationSec);

    return { output: text, detailHash, sessionId, assembledPrompt: "", usage };
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
