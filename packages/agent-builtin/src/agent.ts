import type { Store } from "@ocas/core";
import { createLogger, generateUlid } from "@united-workforce/util";
import { type AgentContext, type AgentRunResult, createAgent } from "@united-workforce/util-agent";

import { storeBuiltinDetail } from "./detail.js";
import { loadBuiltinLlmConfig } from "./llm/config.js";
import type { ChatMessage, ResolvedLlmProvider } from "./llm/index.js";
import { BUILTIN_CONTINUE_MAX_TURNS, BUILTIN_MAX_TURNS, runBuiltinLoop } from "./loop.js";
import { buildBuiltinMessages } from "./prompt.js";
import { initSessionDir } from "./session.js";

const log = createLogger({ sink: { kind: "stderr" } });

const FRONTMATTER_FENCE = "---";

/**
 * Strip any text before the first `---` fence.
 * LLMs sometimes emit preamble text before the frontmatter block.
 */
function stripPreamble(text: string): string {
  if (text.startsWith(FRONTMATTER_FENCE)) {
    return text;
  }
  const idx = text.indexOf(`\n${FRONTMATTER_FENCE}\n`);
  if (idx !== -1) {
    log("6GWRP3QX", `stripped ${idx + 1} chars of preamble before frontmatter`);
    return text.slice(idx + 1);
  }
  return text;
}

type SessionRecord = {
  sessionId: string;
  model: string;
  startedAtMs: number;
  messages: ChatMessage[];
  storageRoot: string;
};

const sessions = new Map<string, SessionRecord>();

function getSession(sessionId: string): SessionRecord {
  const session = sessions.get(sessionId);
  if (session === undefined) {
    throw new Error(`builtin session not found: ${sessionId}`);
  }
  return session;
}

function buildToolContext(storageRoot: string): { cwd: string; storageRoot: string } {
  return {
    cwd: process.cwd(),
    storageRoot,
  };
}

async function runBuiltinWithMessages(
  storageRoot: string,
  provider: ResolvedLlmProvider,
  messages: ChatMessage[],
  session: SessionRecord,
  store: Store,
  maxTurns: number,
  noTools: boolean,
): Promise<AgentRunResult> {
  const loopResult = await runBuiltinLoop({
    provider,
    messages,
    toolCtx: buildToolContext(storageRoot),
    maxTurns,
    storageRoot,
    sessionId: session.sessionId,
    noTools,
  });

  session.messages = loopResult.messages;

  if (loopResult.turnCount === 0) {
    log("5RWTK9NB", "no turns produced, returning empty output");
    return {
      output: "",
      detailHash: "",
      sessionId: session.sessionId,
      assembledPrompt: "",
      usage: null,
    };
  }

  // Read jsonl → persist turns to CAS → store detail
  const { detailHash } = await storeBuiltinDetail(
    store,
    storageRoot,
    session.sessionId,
    session.model,
    session.startedAtMs,
  );

  return {
    output: stripPreamble(loopResult.finalText),
    detailHash,
    sessionId: session.sessionId,
    assembledPrompt: "",
    usage: null,
  };
}

async function runBuiltin(ctx: AgentContext): Promise<AgentRunResult> {
  const storageRoot = ctx.storageRoot;
  const provider = await loadBuiltinLlmConfig(storageRoot);

  const sessionId = generateUlid(Date.now());
  await initSessionDir(storageRoot);
  const messages = buildBuiltinMessages(ctx);

  const session: SessionRecord = {
    sessionId,
    model: provider.model,
    startedAtMs: Date.now(),
    messages,
    storageRoot,
  };
  sessions.set(sessionId, session);

  return runBuiltinWithMessages(
    storageRoot,
    provider,
    messages,
    session,
    ctx.store,
    BUILTIN_MAX_TURNS,
    false,
  );
}

async function continueBuiltin(
  sessionId: string,
  message: string,
  store: Store,
): Promise<AgentRunResult> {
  const session = getSession(sessionId);
  const storageRoot = session.storageRoot;
  const provider = await loadBuiltinLlmConfig(storageRoot);

  const messages: ChatMessage[] = [...session.messages, { role: "user", content: message }];

  return runBuiltinWithMessages(
    storageRoot,
    provider,
    messages,
    session,
    store,
    BUILTIN_CONTINUE_MAX_TURNS,
    true,
  );
}

/** Agent CLI factory: built-in LLM loop with file/shell tools. */
export function createBuiltinAgent(): () => Promise<void> {
  return createAgent({
    name: "builtin",
    run: runBuiltin,
    continue: continueBuiltin,
    fork: null,
    cleanup: null,
  });
}
