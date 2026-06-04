import type { Store } from "@ocas/core";
import type { Usage } from "@united-workforce/protocol";
import { createLogger } from "@united-workforce/util";
import {
  type AgentContext,
  type AgentRunResult,
  buildContinuationPrompt,
  buildRolePrompt,
  createAgent,
} from "@united-workforce/util-agent";

import { HermesAcpClient } from "./acp-client.js";
import { getCachedSessionId, setCachedSessionId } from "./session-cache.js";
import { loadHermesSession, storeHermesSessionDetail } from "./session-detail.js";
import type { HermesSessionJson } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

/** Snapshot of session metrics taken before and after a prompt call. */
type UsageSnapshot = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
};

const ZERO_SNAPSHOT: UsageSnapshot = { turns: 0, inputTokens: 0, outputTokens: 0 };

/** Extract usage metrics from a session. Returns zeros for null sessions. */
export function snapshotUsage(session: HermesSessionJson | null): UsageSnapshot {
  if (session === null) {
    return ZERO_SNAPSHOT;
  }
  return {
    turns: session.messages.filter((m) => m.role === "assistant").length,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
  };
}

/** Compute the delta between two snapshots (after minus before). Floors at 0. */
export function computeUsageDelta(
  before: UsageSnapshot,
  after: UsageSnapshot,
  durationSec: number,
): Usage {
  return {
    turns: Math.max(0, after.turns - before.turns) || 1,
    inputTokens: Math.max(0, after.inputTokens - before.inputTokens),
    outputTokens: Math.max(0, after.outputTokens - before.outputTokens),
    duration: Math.round(durationSec),
  };
}

/** Assemble system prompt, task, and prior step outputs for Hermes. */
export function buildHermesPrompt(ctx: AgentContext): string {
  const parts: string[] = [];

  if (ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }

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
};

async function prepareSession(
  client: HermesAcpClient,
  ctx: AgentContext,
  cwd: string,
  resumeDisabled: boolean,
): Promise<PromptAttempt> {
  if (ctx.isFirstVisit || resumeDisabled) {
    await client.connect(cwd);
    return { useContinuation: false, resumed: false };
  }

  const cachedSessionId = await getCachedSessionId(ctx.threadId, ctx.role, ctx.storageRoot);
  if (cachedSessionId === null) {
    log("6RWK3N8Q", `no cached session for ${ctx.threadId}:${ctx.role}, starting new session`);
    await client.connect(cwd);
    return { useContinuation: false, resumed: false };
  }

  try {
    await client.resume(cachedSessionId, cwd);
    log("9MHT4V2P", `resumed hermes session ${cachedSessionId} for ${ctx.threadId}:${ctx.role}`);
    return { useContinuation: true, resumed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("3XPN7K4W", `session resume failed, falling back to new session: ${message}`);
    await client.close();
    await client.connect(cwd);
    return { useContinuation: false, resumed: false };
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
    beforeSnapshot: UsageSnapshot,
  ): Promise<AgentRunResult> {
    const effectiveCtx = useContinuation ? ctx : { ...ctx, isFirstVisit: true };
    const fullPrompt = buildHermesPrompt(effectiveCtx);
    const startMs = Date.now();
    const { text, sessionId } = await client.prompt(fullPrompt);
    const durationSec = (Date.now() - startMs) / 1000;
    const { detailHash } = await storePromptResult(ctx.store, sessionId);

    if (!resumeDisabled) {
      await setCachedSessionId(ctx.threadId, ctx.role, sessionId, ctx.storageRoot);
    }

    const afterSession = await loadHermesSession(sessionId);
    const afterSnapshot = snapshotUsage(afterSession);
    const usage = computeUsageDelta(beforeSnapshot, afterSnapshot, durationSec);

    return { output: text, detailHash, sessionId, assembledPrompt: fullPrompt, usage };
  }

  async function runHermes(ctx: AgentContext): Promise<AgentRunResult> {
    const cwd = process.cwd();
    const attempt = await prepareSession(client, ctx, cwd, resumeDisabled);

    // Snapshot before prompt: for resumed sessions, captures cumulative state
    // so we can compute the delta. For new sessions, this is ZERO_SNAPSHOT.
    const currentSessionId = client.getSessionId();
    const beforeSession =
      attempt.resumed && currentSessionId !== null
        ? await loadHermesSession(currentSessionId)
        : null;
    const beforeSnapshot = snapshotUsage(beforeSession);

    try {
      return await runPrompt(ctx, attempt.useContinuation, beforeSnapshot);
    } catch (error) {
      if (!attempt.resumed) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      log("8FQW2R6N", `continuation prompt failed, retrying with initial prompt: ${message}`);
      await client.close();
      await client.connect(cwd);
      // Fresh session after retry — reset snapshot to zero
      return runPrompt(ctx, false, ZERO_SNAPSHOT);
    }
  }

  async function continueHermes(
    _sessionId: string,
    message: string,
    store: Store,
  ): Promise<AgentRunResult> {
    // Client is already connected from runHermes — same ACP session,
    // so the agent sees the full conversation history (crucial for retries).
    // Snapshot before the continuation prompt for delta computation.
    const currentSessionId = client.getSessionId();
    const beforeSession =
      currentSessionId !== null ? await loadHermesSession(currentSessionId) : null;
    const beforeSnapshot = snapshotUsage(beforeSession);

    const startMs = Date.now();
    const { text, sessionId } = await client.prompt(message);
    const durationSec = (Date.now() - startMs) / 1000;
    const { detailHash } = await storePromptResult(store, sessionId);

    const afterSession = await loadHermesSession(sessionId);
    const afterSnapshot = snapshotUsage(afterSession);
    const usage = computeUsageDelta(beforeSnapshot, afterSnapshot, durationSec);

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
