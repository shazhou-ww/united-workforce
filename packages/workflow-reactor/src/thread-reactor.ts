import type * as z from "zod/v4";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import type {
  ChatMessage,
  StructuredToolSpec,
  ThreadReactorConfig,
  ThreadReactorFn,
  ToolCall,
  ToolDefinition,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJsonContent(content: string): unknown | null {
  const trimmed = content.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const payload = fenceMatch !== null ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function firstAssistantMessage(responseText: string): Result<Record<string, unknown>, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(`invalid_response_json:${message}`);
  }
  if (!isRecord(parsed)) {
    return err("invalid_response_top_level");
  }
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return err("no_choices_in_response");
  }
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    return err("invalid_choice");
  }
  const messageObj = firstChoice.message;
  if (!isRecord(messageObj)) {
    return err("invalid_message");
  }
  return ok(messageObj);
}

function normalizeToolCalls(toolCallsRaw: unknown[]): Result<ToolCall[], string> {
  const toolCalls: ToolCall[] = [];
  for (const tc of toolCallsRaw) {
    if (!isRecord(tc)) {
      return err("invalid_tool_call");
    }
    const id = tc.id;
    const tcType = tc.type;
    const fn = tc.function;
    if (typeof id !== "string" || tcType !== "function" || !isRecord(fn)) {
      return err("invalid_tool_call_shape");
    }
    const name = fn.name;
    const argumentsStr = fn.arguments;
    if (typeof name !== "string" || typeof argumentsStr !== "string") {
      return err("invalid_tool_call_function");
    }
    toolCalls.push({ id, type: "function", function: { name, arguments: argumentsStr } });
  }
  return ok(toolCalls);
}

type AssistantTurn<T> =
  | { kind: "plain_json"; value: T }
  | { kind: "tool_calls"; calls: ToolCall[]; assistantContent: string | null };

type AssistantTurnOrCorrection<T> =
  | AssistantTurn<T>
  | { kind: "plain_json_invalid"; rawContent: string; correction: string };

function classifyAssistantTurn<T>(
  messageObj: Record<string, unknown>,
  schema: z.ZodType<T>,
  structuredToolName: string,
): Result<AssistantTurnOrCorrection<T>, string> {
  const toolCallsRaw = messageObj.tool_calls;
  if (!Array.isArray(toolCallsRaw) || toolCallsRaw.length === 0) {
    const content = messageObj.content;
    if (typeof content !== "string") {
      return err("no_tool_calls_and_no_string_content");
    }
    const jsonParsed = tryParseJsonContent(content);
    if (jsonParsed === null) {
      return ok({
        kind: "plain_json_invalid",
        rawContent: content,
        correction: `Your previous reply was not valid JSON and contained no tool calls. Reply with a single JSON object that matches the schema, or call the ${structuredToolName} tool with the structured arguments.`,
      });
    }
    const validated = schema.safeParse(jsonParsed);
    if (!validated.success) {
      return ok({
        kind: "plain_json_invalid",
        rawContent: content,
        correction: `Your previous JSON reply did not satisfy the schema: ${validated.error.message}. Reply again with a JSON object that matches the schema, or call the ${structuredToolName} tool with the structured arguments.`,
      });
    }
    return ok({ kind: "plain_json", value: validated.data });
  }
  const callsResult = normalizeToolCalls(toolCallsRaw);
  if (!callsResult.ok) {
    return err(callsResult.error);
  }
  const assistantContent = messageObj.content;
  return ok({
    kind: "tool_calls",
    calls: callsResult.value,
    assistantContent: typeof assistantContent === "string" ? assistantContent : null,
  });
}

function toolNamesFromDefinitions(tools: readonly { function: { name: string } }[]): Set<string> {
  return new Set(tools.map((t) => t.function.name));
}

function appendStructuredToolResult<T>(
  tc: ToolCall,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
): T | null {
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(tc.function.arguments) as unknown;
  } catch {
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content:
        "Tool arguments were not valid JSON. Provide valid JSON object arguments matching the schema.",
    });
    return null;
  }
  const validated = schema.safeParse(parsedArgs);
  if (!validated.success) {
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: `Schema validation failed: ${validated.error.message}. Fix the arguments and call the tool again with a JSON object that matches the schema.`,
    });
    return null;
  }
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    content: '{"ok":true}',
  });
  return validated.data;
}

async function dispatchToolCall<T, TThread>(
  tc: ToolCall,
  spec: StructuredToolSpec,
  knownNames: Set<string>,
  schema: z.ZodType<T>,
  thread: TThread,
  toolHandler: ThreadReactorConfig<TThread>["toolHandler"],
  messages: ChatMessage[],
): Promise<T | null> {
  if (!knownNames.has(tc.function.name)) {
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: `Unknown tool: ${tc.function.name}. Use one of the declared tools only.`,
    });
    return null;
  }
  if (tc.function.name === spec.name) {
    return appendStructuredToolResult(tc, schema, messages);
  }
  let toolContent: string;
  try {
    toolContent = await toolHandler(tc, thread);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    toolContent = `Tool execution failed: ${message}`;
  }
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    content: toolContent,
  });
  return null;
}

async function resolveToolCallRound<T, TThread>(
  turn: Extract<AssistantTurn<T>, { kind: "tool_calls" }>,
  spec: StructuredToolSpec,
  knownNames: Set<string>,
  schema: z.ZodType<T>,
  thread: TThread,
  toolHandler: ThreadReactorConfig<TThread>["toolHandler"],
  messages: ChatMessage[],
): Promise<Result<T, string> | null> {
  messages.push({
    role: "assistant",
    content: turn.assistantContent,
    tool_calls: turn.calls,
  });
  let extractedRound: T | null = null;
  for (const tc of turn.calls) {
    const extracted = await dispatchToolCall(
      tc,
      spec,
      knownNames,
      schema,
      thread,
      toolHandler,
      messages,
    );
    if (extracted !== null) {
      extractedRound = extracted;
    }
  }
  if (extractedRound !== null) {
    return ok(extractedRound);
  }
  return null;
}

async function runOneReactRound<T, TThread>(
  config: ThreadReactorConfig<TThread>,
  args: { thread: TThread; schema: z.ZodType<T> },
  tools: readonly ToolDefinition[],
  knownNames: Set<string>,
  spec: StructuredToolSpec,
  messages: ChatMessage[],
): Promise<Result<T, string> | null> {
  const bodyResult = await config.llm({ messages, tools });
  if (!bodyResult.ok) {
    return bodyResult;
  }

  const msgResult = firstAssistantMessage(bodyResult.value);
  if (!msgResult.ok) {
    return msgResult;
  }

  const classified = classifyAssistantTurn(msgResult.value, args.schema, spec.name);
  if (!classified.ok) {
    return classified;
  }

  const turn = classified.value;
  if (turn.kind === "plain_json") {
    return ok(turn.value);
  }

  if (turn.kind === "plain_json_invalid") {
    messages.push({ role: "assistant", content: turn.rawContent });
    messages.push({ role: "user", content: turn.correction });
    return null;
  }

  return resolveToolCallRound(
    turn,
    spec,
    knownNames,
    args.schema,
    args.thread,
    config.toolHandler,
    messages,
  );
}

/**
 * Generic ReAct loop: LLM round-trips with tools until structured output validates,
 * plain JSON matches schema, or {@link ThreadReactorConfig.maxRounds} is exceeded.
 */
export function createThreadReactor<TThread>(
  config: ThreadReactorConfig<TThread>,
): ThreadReactorFn<TThread> {
  return async <T>(args: {
    thread: TThread;
    input: string;
    schema: z.ZodType<T>;
  }): Promise<Result<T, string>> => {
    const spec = config.structuredToolFromSchema(args.schema);
    const tools = [...config.staticTools, spec.tool];
    const knownNames = toolNamesFromDefinitions(tools);
    const systemPrompt = config.systemPromptForStructuredTool(spec.name);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: args.input },
    ];

    for (let round = 0; round < config.maxRounds; round++) {
      const step = await runOneReactRound(
        config,
        { thread: args.thread, schema: args.schema },
        tools,
        knownNames,
        spec,
        messages,
      );
      if (step !== null) {
        return step;
      }
    }

    return err("max_react_rounds_exceeded");
  };
}
