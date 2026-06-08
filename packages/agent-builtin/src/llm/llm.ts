import type {
  ChatMessage,
  LlmAssistantResponse,
  LlmToolCall,
  OpenAiToolDefinition,
  ResolvedLlmProvider,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function parseToolCalls(raw: unknown): LlmToolCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const calls: LlmToolCall[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = entry.id;
    const fn = entry.function;
    if (typeof id !== "string" || !isRecord(fn)) {
      continue;
    }
    const name = fn.name;
    const args = fn.arguments;
    if (typeof name !== "string" || typeof args !== "string") {
      continue;
    }
    calls.push({ id, name, arguments: args });
  }
  return calls.length > 0 ? calls : null;
}

function parseAssistantMessage(parsed: unknown): LlmAssistantResponse {
  if (!isRecord(parsed)) {
    throw new Error("LLM response is not an object");
  }
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("LLM response has no choices");
  }
  const c0 = choices[0];
  if (!isRecord(c0)) {
    throw new Error("LLM choice is not an object");
  }
  const messageObj = c0.message;
  if (!isRecord(messageObj)) {
    throw new Error("LLM message is not an object");
  }
  const contentRaw = messageObj.content;
  const content =
    typeof contentRaw === "string"
      ? contentRaw
      : contentRaw === null || contentRaw === undefined
        ? null
        : null;
  const toolCalls = parseToolCalls(messageObj.tool_calls);
  return { content, toolCalls };
}

function serializeMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: message.content,
    };
  }
  if (message.role === "assistant") {
    const base: Record<string, unknown> = {
      role: "assistant",
      content: message.content,
    };
    if (message.tool_calls !== null && message.tool_calls.length > 0) {
      base.tool_calls = message.tool_calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    return base;
  }
  return { role: message.role, content: message.content };
}

/** OpenAI-compatible chat completion with tool calling (non-streaming). */
export async function chatCompletionWithTools(
  provider: ResolvedLlmProvider,
  messages: ChatMessage[],
  tools: OpenAiToolDefinition[] | null,
): Promise<LlmAssistantResponse> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: messages.map(serializeMessage),
  };
  if (tools !== null && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  let response: Response;
  try {
    response = await fetch(chatUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`LLM network error: ${message}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`LLM HTTP ${response.status}: ${responseText.slice(0, 2000)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`LLM invalid JSON response: ${message}`);
  }

  return parseAssistantMessage(parsed);
}
