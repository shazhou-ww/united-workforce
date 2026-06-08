import { createLogger } from "@united-workforce/util";

import {
  type ChatMessage,
  chatCompletionWithTools,
  type LlmToolCall,
  type OpenAiToolDefinition,
  type ResolvedLlmProvider,
} from "./llm/index.js";
import { appendSessionTurn } from "./session.js";
import {
  builtinToolsToOpenAi,
  executeBuiltinTool,
  getBuiltinTools,
  type ToolContext,
} from "./tools/index.js";
import type { BuiltinToolCall, BuiltinTurnPayload } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

export const BUILTIN_MAX_TURNS = 30;
export const BUILTIN_CONTINUE_MAX_TURNS = 5;

export type RunBuiltinLoopOptions = {
  provider: ResolvedLlmProvider;
  messages: ChatMessage[];
  toolCtx: ToolContext;
  maxTurns: number;
  storageRoot: string;
  sessionId: string;
  /** When true, do not provide tools — force LLM to emit text only. */
  noTools: boolean;
};

export type RunBuiltinLoopResult = {
  finalText: string;
  messages: ChatMessage[];
  turnCount: number;
};

function mapToolCallsForPayload(calls: LlmToolCall[]): BuiltinToolCall[] {
  return calls.map((call) => ({
    name: call.name,
    args: call.arguments,
  }));
}

async function appendTurn(
  storageRoot: string,
  sessionId: string,
  payload: BuiltinTurnPayload,
): Promise<void> {
  await appendSessionTurn(storageRoot, sessionId, payload);
}

export async function executeTurnTools(
  calls: Array<{ id: string; name: string; arguments: string }>,
  toolCtx: ToolContext,
  messages: ChatMessage[],
  storageRoot: string,
  sessionId: string,
): Promise<number> {
  let turnCount = 0;
  for (const call of calls) {
    const result = await executeBuiltinTool(call.name, call.arguments, toolCtx);
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
    await appendTurn(storageRoot, sessionId, {
      role: "tool",
      content: result,
      toolCalls: null,
      reasoning: null,
    });
    turnCount += 1;
  }
  return turnCount;
}

export type ShouldNudgeOptions = {
  noTools: boolean;
  text: string;
  turn: number;
  maxTurns: number;
};

const MAX_NUDGES = 3;
const DEADLINE_WARNING_TURNS = 3;

export function shouldInjectDeadlineWarning(
  turn: number,
  maxTurns: number,
  alreadyWarned: boolean,
  noTools: boolean,
): boolean {
  const turnsRemaining = maxTurns - turn;
  return (
    !noTools && !alreadyWarned && turnsRemaining > 0 && turnsRemaining <= DEADLINE_WARNING_TURNS
  );
}

export function shouldProcessToolCalls(toolCalls: LlmToolCall[] | null, noTools: boolean): boolean {
  return !noTools && toolCalls !== null && toolCalls.length > 0;
}

export function extractFinalText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      msg !== undefined &&
      msg.role === "assistant" &&
      msg.content !== null &&
      msg.content.trim() !== ""
    ) {
      return msg.content;
    }
  }
  return "";
}

function injectDeadlineWarning(messages: ChatMessage[], turnsRemaining: number): void {
  log("4NRXW6KT", `${turnsRemaining} turns remaining, injecting deadline warning`);
  messages.push({
    role: "user",
    content:
      `⚠️ You have ${turnsRemaining} turns remaining. ` +
      "Wrap up your work and output the YAML frontmatter starting with `---`. " +
      "If you cannot finish in time, output frontmatter with `status: failed` and describe what remains.",
  });
}

type HandleTextOnlyTurnResult = {
  shouldBreak: boolean;
  finalText: string;
  turnCount: number;
  nudgeCount: number;
  turnAdjustment: number;
};

async function handleTextOnlyTurn(
  text: string,
  messages: ChatMessage[],
  storageRoot: string,
  sessionId: string,
  noTools: boolean,
  turn: number,
  maxTurns: number,
  currentNudgeCount: number,
): Promise<HandleTextOnlyTurnResult> {
  await appendTurn(storageRoot, sessionId, {
    role: "assistant",
    content: text,
    toolCalls: null,
    reasoning: null,
  });
  const turnCount = 1;
  let nudgeCount = currentNudgeCount;
  let turnAdjustment = 0;

  if (shouldNudge({ noTools, text, turn, maxTurns })) {
    nudgeCount += 1;
    log("7FXQM2KN", `text-only turn without frontmatter, nudge ${nudgeCount}/${MAX_NUDGES}`);
    const nudge =
      "You stopped calling tools but your response does not start with the required `---` YAML frontmatter. " +
      "Either continue using tools to complete your work, or output your final response starting with `---`.";
    messages.push({ role: "user", content: nudge });
    // Nudge doesn't consume turn budget (up to MAX_NUDGES)
    if (nudgeCount <= MAX_NUDGES) {
      turnAdjustment = -1;
    }
    return { shouldBreak: false, finalText: "", turnCount, nudgeCount, turnAdjustment };
  }

  return { shouldBreak: true, finalText: text, turnCount, nudgeCount, turnAdjustment };
}

async function handleToolCallTurn(
  content: string,
  toolCalls: LlmToolCall[],
  messages: ChatMessage[],
  storageRoot: string,
  sessionId: string,
  toolCtx: ToolContext,
): Promise<number> {
  await appendTurn(storageRoot, sessionId, {
    role: "assistant",
    content,
    toolCalls: mapToolCallsForPayload(toolCalls),
    reasoning: null,
  });
  let turnCount = 1;

  // Execute tools
  turnCount += await executeTurnTools(toolCalls, toolCtx, messages, storageRoot, sessionId);

  return turnCount;
}

export function shouldNudge({ noTools, text, turn, maxTurns }: ShouldNudgeOptions): boolean {
  return !noTools && !text.trimStart().startsWith("---") && turn < maxTurns - 1;
}

type ProcessLoopIterationResult = {
  shouldBreak: boolean;
  finalText: string;
  turnCount: number;
  nudgeCount: number;
  turnAdjustment: number;
};

async function processLoopIteration(
  options: RunBuiltinLoopOptions,
  messages: ChatMessage[],
  openAiTools: OpenAiToolDefinition[],
  turn: number,
  nudgeCount: number,
): Promise<ProcessLoopIterationResult> {
  const response = await chatCompletionWithTools(
    options.provider,
    messages,
    openAiTools.length > 0 ? openAiTools : null,
  );

  // When noTools is set, ignore any tool_calls the LLM might still return
  const effectiveToolCalls = options.noTools ? null : (response.toolCalls ?? null);

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: response.content,
    tool_calls: effectiveToolCalls,
  };
  messages.push(assistantMessage);

  if (!shouldProcessToolCalls(effectiveToolCalls, options.noTools)) {
    const text = response.content ?? "";
    const result = await handleTextOnlyTurn(
      text,
      messages,
      options.storageRoot,
      options.sessionId,
      options.noTools,
      turn,
      options.maxTurns,
      nudgeCount,
    );
    return result;
  }

  // At this point, effectiveToolCalls is guaranteed to be non-null and non-empty
  const turnCount = await handleToolCallTurn(
    response.content ?? "",
    effectiveToolCalls as LlmToolCall[],
    messages,
    options.storageRoot,
    options.sessionId,
    options.toolCtx,
  );

  return {
    shouldBreak: false,
    finalText: "",
    turnCount,
    nudgeCount,
    turnAdjustment: 0,
  };
}

/** Agent run loop: LLM ↔ tools until no tool_calls or maxTurns. */
export async function runBuiltinLoop(
  options: RunBuiltinLoopOptions,
): Promise<RunBuiltinLoopResult> {
  const messages = [...options.messages];
  const openAiTools = options.noTools ? [] : builtinToolsToOpenAi(getBuiltinTools());
  let finalText = "";
  let turnCount = 0;
  let nudgeCount = 0;
  let deadlineWarned = false;

  for (let turn = 0; turn < options.maxTurns; turn++) {
    log("8K2M4N7P", `builtin loop turn ${turn + 1}/${options.maxTurns}`);

    // Warn agent when approaching turn limit
    if (shouldInjectDeadlineWarning(turn, options.maxTurns, deadlineWarned, options.noTools)) {
      deadlineWarned = true;
      const turnsRemaining = options.maxTurns - turn;
      injectDeadlineWarning(messages, turnsRemaining);
    }

    const result = await processLoopIteration(options, messages, openAiTools, turn, nudgeCount);
    turnCount += result.turnCount;
    nudgeCount = result.nudgeCount;
    turn += result.turnAdjustment;

    if (result.shouldBreak) {
      finalText = result.finalText;
      break;
    }
  }

  if (finalText === "") {
    finalText = extractFinalText(messages);
  }

  return { finalText, messages, turnCount };
}
