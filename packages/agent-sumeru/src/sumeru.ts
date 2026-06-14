import type { Store } from "@ocas/core";
import { putSchema } from "@ocas/core";
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
  getCachedSessionId,
  setCachedSessionId,
} from "@united-workforce/util-agent";

import { createSumeruConfigLoader, resolveDefaultInstanceUrl } from "./config.js";
import { createSumeruSession, SumeruSessionNotFoundError, sendSumeruMessage } from "./http.js";
import type { SumeruConfig, SumeruSseOutcome } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const TEXT_SCHEMA = { type: "string" as const };

const SUMERU_AGENT_NAME = "sumeru";

/** Assemble system prompt, task, and prior step outputs for the sumeru adapter. */
export function buildSumeruPrompt(ctx: AgentContext): string {
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";

  const parts: string[] = [];
  if (ctx.outputFormatInstruction !== undefined && ctx.outputFormatInstruction !== "") {
    parts.push(ctx.outputFormatInstruction, "");
  }

  parts.push(buildThreadProgress(ctx.steps, ctx.role, ctx.threadId), "");
  parts.push(rolePrompt, "", "## Task", ctx.start.prompt);

  if (!ctx.isFirstVisit) {
    parts.push("", buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt));
  } else if (ctx.steps.length > 0) {
    parts.push(
      "",
      buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt, {
        includeContent: true,
        quota: 32000,
      }),
    );
  } else {
    parts.push("", "## Moderator Instruction", "", ctx.edgePrompt);
  }

  return parts.join("\n");
}

/**
 * Store an `@uwf/text` CAS node summarising one SSE exchange and return its
 * hash. The text schema is registered idempotently so multiple writes in a
 * single CLI invocation share the same hash.
 */
async function storeSseDetail(
  store: Store,
  sessionId: string,
  outcome: SumeruSseOutcome,
): Promise<string> {
  const textHash = await putSchema(store, TEXT_SCHEMA);
  const durationSec = Math.round(outcome.done.durationMs / 1000);
  const tokensIn = outcome.done.tokens?.in ?? 0;
  const tokensOut = outcome.done.tokens?.out ?? 0;
  const totalTokens = tokensIn + tokensOut;
  const summary =
    `sumeru session ${sessionId} returned ${outcome.assistantTurnCount} assistant turns, ` +
    `${totalTokens} tokens (in=${tokensIn}, out=${tokensOut}), duration ${durationSec}s`;
  return store.cas.put(textHash, summary);
}

function buildUsage(outcome: SumeruSseOutcome): Usage {
  const tokensIn = outcome.done.tokens?.in ?? 0;
  const tokensOut = outcome.done.tokens?.out ?? 0;
  return {
    turns: outcome.assistantTurnCount,
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    duration: Math.round(outcome.done.durationMs / 1000),
  };
}

type SendArgs = {
  instanceUrl: string;
  gateway: string;
  sessionId: string;
  content: string;
};

/**
 * Send a message, retrying once with a fresh session on `404 session_not_found`.
 * The new session id (when retried) is written back to the per-(thread, role)
 * cache before the retry's response is consumed so a crash mid-stream still
 * leaves the session reusable.
 */
async function sendWithSessionRetry(
  args: SendArgs,
  onSessionReplaced: ((newSessionId: string) => Promise<void>) | null,
): Promise<{ sessionId: string; outcome: SumeruSseOutcome }> {
  try {
    const outcome = await sendSumeruMessage(args);
    return { sessionId: args.sessionId, outcome };
  } catch (err) {
    if (err instanceof SumeruSessionNotFoundError) {
      log(
        "8GHN3K2W",
        `cached sumeru session ${args.sessionId} rejected (session_not_found); creating fresh session`,
      );
      const newSessionId = await createSumeruSession({
        instanceUrl: args.instanceUrl,
        gateway: args.gateway,
      });
      if (onSessionReplaced !== null) {
        await onSessionReplaced(newSessionId);
      }
      const outcome = await sendSumeruMessage({ ...args, sessionId: newSessionId });
      return { sessionId: newSessionId, outcome };
    }
    throw err;
  }
}

/**
 * Resolve the Sumeru session id for `(threadId, role)`, creating one on cache
 * miss and writing it back to the cache before the first message is sent.
 */
async function resolveSessionId(
  config: SumeruConfig,
  ctx: AgentContext,
): Promise<{ sessionId: string; fromCache: boolean }> {
  const cached = await getCachedSessionId(
    SUMERU_AGENT_NAME,
    ctx.threadId,
    ctx.role,
    ctx.storageRoot,
  );
  if (cached !== null) {
    log("J9PR3T7K", `reusing cached sumeru session ${cached} for ${ctx.threadId}:${ctx.role}`);
    return { sessionId: cached, fromCache: true };
  }
  const instanceUrl = resolveDefaultInstanceUrl(config);
  const sessionId = await createSumeruSession({
    instanceUrl,
    gateway: config.defaultGateway,
  });
  await setCachedSessionId(SUMERU_AGENT_NAME, ctx.threadId, ctx.role, sessionId, ctx.storageRoot);
  log(
    "F4WK2NQ8",
    `created sumeru session ${sessionId} on gateway=${config.defaultGateway} for ${ctx.threadId}:${ctx.role}`,
  );
  return { sessionId, fromCache: false };
}

async function runSumeru(
  ctx: AgentContext,
  loadConfig: () => Promise<SumeruConfig>,
): Promise<AgentRunResult> {
  const config = await loadConfig();
  const instanceUrl = resolveDefaultInstanceUrl(config);

  const { sessionId: initialSessionId, fromCache } = await resolveSessionId(config, ctx);

  // Frontmatter retry path: cache hit + isFirstVisit means a previous run
  // produced output that failed validation. Send a minimal correction
  // prompt instead of the full assembled prompt — the session already has
  // the original context.
  const fullPrompt =
    fromCache && ctx.isFirstVisit
      ? buildFrontmatterRetryPrompt(ctx.outputFormatInstruction)
      : buildSumeruPrompt(ctx);

  log("M2VP7Q3X", `prompt for role=${ctx.role} length=${fullPrompt.length}`);
  if (process.env.UWF_DEBUG === "1" || process.env.UWF_DEBUG === "true") {
    log("D5K4N9R7", `prompt body for role=${ctx.role}:\n${fullPrompt}`);
  }

  const { sessionId: finalSessionId, outcome } = await sendWithSessionRetry(
    {
      instanceUrl,
      gateway: config.defaultGateway,
      sessionId: initialSessionId,
      content: fullPrompt,
    },
    async (newSessionId) => {
      await setCachedSessionId(
        SUMERU_AGENT_NAME,
        ctx.threadId,
        ctx.role,
        newSessionId,
        ctx.storageRoot,
      );
    },
  );

  const detailHash = await storeSseDetail(ctx.store, finalSessionId, outcome);
  const usage = buildUsage(outcome);

  return {
    output: outcome.output,
    detailHash,
    sessionId: finalSessionId,
    assembledPrompt: fullPrompt,
    usage,
  };
}

async function continueSumeru(
  sessionId: string,
  message: string,
  store: Store,
  loadConfig: () => Promise<SumeruConfig>,
): Promise<AgentRunResult> {
  const config = await loadConfig();
  const instanceUrl = resolveDefaultInstanceUrl(config);

  log("Q6RT3N8W", `continue sumeru session ${sessionId} (gateway=${config.defaultGateway})`);
  const outcome = await sendSumeruMessage({
    instanceUrl,
    gateway: config.defaultGateway,
    sessionId,
    content: message,
  });

  const detailHash = await storeSseDetail(store, sessionId, outcome);
  const usage = buildUsage(outcome);

  return {
    output: outcome.output,
    detailHash,
    sessionId,
    assembledPrompt: "",
    usage,
  };
}

/**
 * Agent CLI factory: parses argv, runs Sumeru, extracts output, writes
 * StepNode. The returned async function is what the binary calls.
 *
 * Config is loaded lazily through a memoising closure so the YAML file is
 * read at most once per CLI invocation, regardless of how many times
 * `run()` / `continue()` are called (retry loop).
 */
export function createSumeruAgent(storageRoot: string): () => Promise<void> {
  const loadConfig = createSumeruConfigLoader(storageRoot);
  return createAgent({
    name: SUMERU_AGENT_NAME,
    run: (ctx) => runSumeru(ctx, loadConfig),
    continue: (sessionId, message, store) => continueSumeru(sessionId, message, store, loadConfig),
    fork: null,
    cleanup: null,
  });
}

// Re-exports for tests that need to exercise the per-component logic.
export { buildUsage, storeSseDetail };
