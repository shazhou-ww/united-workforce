import type { ResolvedLlmProvider } from "@uncaged/workflow-agent-kit";
import { createLogger } from "@uncaged/workflow-util";

import { type ChatMessage, chatCompletionWithTools, type LlmToolCall } from "./llm/index.js";
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

export function shouldNudge({ noTools, text, turn, maxTurns }: ShouldNudgeOptions): boolean {
  return !noTools && !text.trimStart().startsWith("---") && turn < maxTurns - 1;
}

/** Agent run loop: LLM ↔ tools until no tool_calls or maxTurns. */
export async function runBuiltinLoop(
  options: RunBuiltinLoopOptions,
): Promise<RunBuiltinLoopResult> {
  const messages = [...options.messages];
  const openAiTools = options.noTools ? [] : builtinToolsToOpenAi(getBuiltinTools());
  let finalText = "";
  let turnCount = 0;

  for (let turn = 0; turn < options.maxTurns; turn++) {
    log("8K2M4N7P", `builtin loop turn ${turn + 1}/${options.maxTurns}`);
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

    if (effectiveToolCalls === null || effectiveToolCalls.length === 0) {
      const text = response.content ?? "";
      await appendTurn(options.storageRoot, options.sessionId, {
        role: "assistant",
        content: text,
        toolCalls: null,
        reasoning: null,
      });
      turnCount += 1;

      if (shouldNudge({ noTools: options.noTools, text, turn, maxTurns: options.maxTurns })) {
        log("7FXQM2KN", "text-only turn without frontmatter, nudging LLM to continue");
        const nudge =
          "You stopped calling tools but your response does not start with the required `---` YAML frontmatter. " +
          "Either continue using tools to complete your work, or output your final response starting with `---`.";
        messages.push({ role: "user", content: nudge });
        continue;
      }

      finalText = text;
      break;
    }

    // Assistant turn with tool calls
    await appendTurn(options.storageRoot, options.sessionId, {
      role: "assistant",
      content: response.content ?? "",
      toolCalls: mapToolCallsForPayload(effectiveToolCalls),
      reasoning: null,
    });
    turnCount += 1;

    // Execute tools
    turnCount += await executeTurnTools(
      effectiveToolCalls,
      options.toolCtx,
      messages,
      options.storageRoot,
      options.sessionId,
    );
  }

  if (finalText === "" && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg !== undefined &&
        msg.role === "assistant" &&
        msg.content !== null &&
        msg.content.trim() !== ""
      ) {
        finalText = msg.content;
        break;
      }
    }
  }

  return { finalText, messages, turnCount };
}
