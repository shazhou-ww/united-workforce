import type * as z from "zod/v4";

import type { CasStore } from "./cas.js";
import { extractFunctionToolFromZodSchema } from "./llm-extract.js";
import { err, ok, type Result } from "./result.js";
import type { LlmProvider } from "./types.js";

export type ReactExtractArgs<T extends Record<string, unknown>> = {
  text: string;
  schema: z.ZodType<T>;
  provider: LlmProvider;
  cas: CasStore;
};

const MAX_REACT_ROUNDS = 10;

const CAS_GET_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "cas_get",
    description:
      "Read a Merkle DAG node from content-addressed storage by its hash. Returns YAML-formatted node with type, payload, and children fields.",
    parameters: {
      type: "object",
      properties: {
        hash: { type: "string", description: "The CAS hash to retrieve" },
      },
      required: ["hash"],
    },
  },
};

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

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

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: ToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type AssistantTurn<T> =
  | { kind: "plain_json"; value: T }
  | { kind: "tool_calls"; calls: ToolCall[]; assistantContent: string | null };

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

function classifyAssistantTurn<T extends Record<string, unknown>>(
  messageObj: Record<string, unknown>,
  schema: z.ZodType<T>,
): Result<AssistantTurn<T>, string> {
  const toolCallsRaw = messageObj.tool_calls;
  if (!Array.isArray(toolCallsRaw) || toolCallsRaw.length === 0) {
    const content = messageObj.content;
    if (typeof content !== "string") {
      return err("no_tool_calls_and_no_string_content");
    }
    const jsonParsed = tryParseJsonContent(content);
    if (jsonParsed === null) {
      return err("no_tool_calls_and_content_not_json");
    }
    const validated = schema.safeParse(jsonParsed);
    if (!validated.success) {
      return err(`schema_validation_failed:${validated.error.message}`);
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

async function appendCasGetToolResult(
  tc: ToolCall,
  cas: CasStore,
  messages: ChatMessage[],
): Promise<Result<null, string>> {
  let hash: string;
  try {
    const ta = JSON.parse(tc.function.arguments) as unknown;
    if (!isRecord(ta) || typeof ta.hash !== "string") {
      return err("cas_get_invalid_arguments");
    }
    hash = ta.hash;
  } catch {
    return err("cas_get_arguments_not_json");
  }
  const blob = await cas.get(hash);
  const toolContent = blob === null ? "null" : blob;
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    content: toolContent,
  });
  return ok(null);
}

async function appendExtractToolResult<T extends Record<string, unknown>>(
  tc: ToolCall,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
): Promise<Result<T, string>> {
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(tc.function.arguments) as unknown;
  } catch {
    return err("extract_tool_arguments_not_json");
  }
  const validated = schema.safeParse(parsedArgs);
  if (!validated.success) {
    return err(`schema_validation_failed:${validated.error.message}`);
  }
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    content: '{"ok":true}',
  });
  return ok(validated.data);
}

async function appendToolResults<T extends Record<string, unknown>>(
  toolCalls: ToolCall[],
  extractToolName: string,
  schema: z.ZodType<T>,
  cas: CasStore,
  messages: ChatMessage[],
): Promise<Result<T | null, string>> {
  let extracted: T | null = null;
  for (const tc of toolCalls) {
    if (tc.function.name === "cas_get") {
      const casRes = await appendCasGetToolResult(tc, cas, messages);
      if (!casRes.ok) {
        return casRes;
      }
      continue;
    }
    if (tc.function.name === extractToolName) {
      const exRes = await appendExtractToolResult(tc, schema, messages);
      if (!exRes.ok) {
        return exRes;
      }
      extracted = exRes.value;
      continue;
    }
    return err(`unknown_tool:${tc.function.name}`);
  }
  return ok(extracted);
}

async function postChatCompletion(
  provider: LlmProvider,
  messages: ChatMessage[],
  tools: readonly Record<string, unknown>[],
): Promise<Result<string, string>> {
  try {
    const response = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return err(`http_error:${String(response.status)}:${responseText.slice(0, 4000)}`);
    }
    return ok(responseText);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(`network_error:${message}`);
  }
}

/**
 * Multi-turn ReAct extraction with `cas_get` plus a schema-shaped extract tool (OpenAI-compatible).
 * Final meta comes from a successful extract tool call or from plain JSON in the assistant message.
 */
export async function reactExtract<T extends Record<string, unknown>>(
  args: ReactExtractArgs<T>,
): Promise<Result<T, string>> {
  const extractTool = extractFunctionToolFromZodSchema(args.schema);
  const tools = [
    CAS_GET_TOOL_DEFINITION,
    {
      type: "function" as const,
      function: {
        name: extractTool.name,
        description: extractTool.description,
        parameters: extractTool.parameters,
      },
    },
  ];

  const systemContent = `You extract structured metadata from the agent output below. Use cas_get to read Merkle DAG nodes from CAS (YAML: type, payload, children) when the agent output references hashes you must traverse. When you have the complete structured object, call the ${extractTool.name} tool with JSON arguments matching the schema. You may instead reply with only a JSON object (no prose) when no tools are needed.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: args.text },
  ];

  for (let round = 0; round < MAX_REACT_ROUNDS; round++) {
    const bodyResult = await postChatCompletion(args.provider, messages, tools);
    if (!bodyResult.ok) {
      return bodyResult;
    }

    const msgResult = firstAssistantMessage(bodyResult.value);
    if (!msgResult.ok) {
      return msgResult;
    }

    const classified = classifyAssistantTurn(msgResult.value, args.schema);
    if (!classified.ok) {
      return classified;
    }

    const turn = classified.value;
    if (turn.kind === "plain_json") {
      return ok(turn.value);
    }

    messages.push({
      role: "assistant",
      content: turn.assistantContent,
      tool_calls: turn.calls,
    });

    const toolsRound = await appendToolResults(
      turn.calls,
      extractTool.name,
      args.schema,
      args.cas,
      messages,
    );
    if (!toolsRound.ok) {
      return toolsRound;
    }
    if (toolsRound.value !== null) {
      return ok(toolsRound.value);
    }
  }

  return err("max_react_rounds_exceeded");
}
