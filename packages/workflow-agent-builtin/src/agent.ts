import type { Store } from "@uncaged/json-cas";
import {
  type AgentContext,
  type AgentRunResult,
  createAgent,
  loadWorkflowConfig,
  resolveModel,
  resolveStorageRoot,
} from "@uncaged/workflow-agent-kit";
import { generateUlid } from "@uncaged/workflow-util";

import { storeBuiltinDetail } from "./detail.js";
import type { ChatMessage } from "./llm/index.js";
import { BUILTIN_CONTINUE_MAX_TURNS, BUILTIN_MAX_TURNS, runBuiltinLoop } from "./loop.js";
import { buildBuiltinMessages } from "./prompt.js";
import type { BuiltinSessionState } from "./types.js";

const sessions = new Map<string, BuiltinSessionState>();

function getSession(sessionId: string): BuiltinSessionState {
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
  provider: ReturnType<typeof resolveModel>,
  messages: ChatMessage[],
  session: BuiltinSessionState,
  store: Store,
  maxTurns: number,
): Promise<AgentRunResult> {
  const loopResult = await runBuiltinLoop({
    provider,
    messages,
    toolCtx: buildToolContext(storageRoot),
    maxTurns,
    existingTurns: session.turns,
  });

  session.messages = loopResult.messages;
  session.turns = loopResult.turns;

  const { detailHash, output } = await storeBuiltinDetail(
    store,
    session.sessionId,
    session.model,
    session.startedAtMs,
    session.turns,
  );

  const finalOutput = output !== "" ? output : loopResult.finalText;
  return { output: finalOutput, detailHash, sessionId: session.sessionId };
}

async function runBuiltin(ctx: AgentContext): Promise<AgentRunResult> {
  const storageRoot = resolveStorageRoot();
  const config = await loadWorkflowConfig(storageRoot);
  const provider = resolveModel(config, config.defaultModel);

  const sessionId = generateUlid(Date.now());
  const messages = buildBuiltinMessages(ctx);

  const session: BuiltinSessionState = {
    sessionId,
    model: provider.model,
    startedAtMs: Date.now(),
    messages,
    turns: [],
  };
  sessions.set(sessionId, session);

  return runBuiltinWithMessages(
    storageRoot,
    provider,
    messages,
    session,
    ctx.store,
    BUILTIN_MAX_TURNS,
  );
}

async function continueBuiltin(
  sessionId: string,
  message: string,
  store: Store,
): Promise<AgentRunResult> {
  const session = getSession(sessionId);
  const storageRoot = resolveStorageRoot();
  const config = await loadWorkflowConfig(storageRoot);
  const provider = resolveModel(config, config.defaultModel);

  const messages: ChatMessage[] = [...session.messages, { role: "user", content: message }];

  return runBuiltinWithMessages(
    storageRoot,
    provider,
    messages,
    session,
    store,
    BUILTIN_CONTINUE_MAX_TURNS,
  );
}

/** Agent CLI factory: built-in LLM loop with file/shell tools. */
export function createBuiltinAgent(): () => Promise<void> {
  return createAgent({
    name: "builtin",
    run: runBuiltin,
    continue: continueBuiltin,
  });
}
