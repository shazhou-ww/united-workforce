import type { ResolvedLlmProvider } from "@uncaged/workflow-agent-kit";
import { createLogger } from "@uncaged/workflow-util";

import { type ChatMessage, chatCompletionWithTools, type LlmToolCall } from "./llm/index.js";
import {
  builtinToolsToOpenAi,
  executeBuiltinTool,
  getBuiltinTools,
  type ToolContext,
} from "./tools/index.js";
import type { BuiltinLoopTurn, BuiltinToolCallRecord, BuiltinToolResultRecord } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

export const BUILTIN_MAX_TURNS = 30;
export const BUILTIN_CONTINUE_MAX_TURNS = 5;

export type RunBuiltinLoopOptions = {
  provider: ResolvedLlmProvider;
  messages: ChatMessage[];
  toolCtx: ToolContext;
  maxTurns: number;
  existingTurns: BuiltinLoopTurn[];
};

export type RunBuiltinLoopResult = {
  finalText: string;
  messages: ChatMessage[];
  turns: BuiltinLoopTurn[];
};

function mapToolCalls(calls: LlmToolCall[]): BuiltinToolCallRecord[] {
  return calls.map((call) => ({
    id: call.id,
    name: call.name,
    args: call.arguments,
  }));
}

/** Agent run loop: LLM ↔ tools until no tool_calls or maxTurns. */
export async function runBuiltinLoop(
  options: RunBuiltinLoopOptions,
): Promise<RunBuiltinLoopResult> {
  const messages = [...options.messages];
  const turns = [...options.existingTurns];
  const openAiTools = builtinToolsToOpenAi(getBuiltinTools());
  let finalText = "";

  for (let turn = 0; turn < options.maxTurns; turn++) {
    log("8K2M4N7P", `builtin loop turn ${turn + 1}/${options.maxTurns}`);
    const response = await chatCompletionWithTools(options.provider, messages, openAiTools);

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
    };
    messages.push(assistantMessage);

    if (response.toolCalls === null || response.toolCalls.length === 0) {
      finalText = response.content ?? "";
      turns.push({
        assistantContent: response.content,
        toolCalls: null,
        toolResults: null,
      });
      break;
    }

    const toolCallRecords = mapToolCalls(response.toolCalls);
    const toolResults: BuiltinToolResultRecord[] = [];

    for (const call of response.toolCalls) {
      const result = await executeBuiltinTool(call.name, call.arguments, options.toolCtx);
      toolResults.push({
        toolCallId: call.id,
        name: call.name,
        content: result,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }

    turns.push({
      assistantContent: response.content,
      toolCalls: toolCallRecords,
      toolResults,
    });
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

  return { finalText, messages, turns };
}
