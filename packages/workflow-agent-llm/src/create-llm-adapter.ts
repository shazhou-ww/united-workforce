import {
  type AdapterFn,
  type AgentFn,
  err,
  type LlmProvider,
  ok,
  type Result,
} from "@uncaged/workflow-runtime";
import { createAgentAdapter } from "@uncaged/workflow-util-agent";

/** OpenAI chat completion message shape (passed to `/chat/completions`). */
export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmChatError =
  | { kind: "http_error"; status: number; body: string }
  | { kind: "invalid_response_json"; message: string }
  | { kind: "network_error"; message: string }
  | { kind: "empty_choices" }
  | { kind: "no_assistant_text" };

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatLlmChatError(e: LlmChatError): string {
  return JSON.stringify(e);
}

async function fetchChatJson(
  provider: LlmProvider,
  body: Record<string, unknown>,
): Promise<Result<unknown, LlmChatError>> {
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
    return err({ kind: "network_error", message });
  }
  const responseText = await response.text();
  if (!response.ok) {
    return err({ kind: "http_error", status: response.status, body: responseText.slice(0, 4000) });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ kind: "invalid_response_json", message });
  }
  return ok(parsed);
}

function parseAssistantText(parsed: unknown): Result<string, LlmChatError> {
  if (!isRecord(parsed)) {
    return err({ kind: "invalid_response_json", message: "Not an object" });
  }
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return err({ kind: "empty_choices" });
  }
  const c0 = choices[0];
  if (!isRecord(c0)) {
    return err({ kind: "empty_choices" });
  }
  const messageObj = c0.message;
  if (!isRecord(messageObj)) {
    return err({ kind: "no_assistant_text" });
  }
  const content = messageObj.content;
  if (typeof content === "string") {
    return ok(content);
  }
  return err({ kind: "no_assistant_text" });
}

export async function chatCompletionText(options: {
  provider: LlmProvider;
  messages: LlmMessage[];
}): Promise<Result<string, LlmChatError>> {
  const body = { model: options.provider.model, messages: options.messages };
  const res = await fetchChatJson(options.provider, body);
  if (!res.ok) {
    return res;
  }
  return parseAssistantText(res.value);
}

type LlmAgentOpt = { prompt: string };

function createLlmAgent(provider: LlmProvider): AgentFn<LlmAgentOpt> {
  return async (ctx, { prompt }) => {
    const result = await chatCompletionText({
      provider,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: ctx.start.content },
      ],
    });
    if (!result.ok) {
      throw new Error(`llm: ${formatLlmChatError(result.error)}`);
    }
    return result.value;
  };
}

/** Single-turn chat adapter: system prompt is passed by the workflow engine. */
export function createLlmAdapter(provider: LlmProvider): AdapterFn {
  return createAgentAdapter(createLlmAgent(provider), async (_ctx, prompt, _runtime) => ({
    prompt,
  }));
}
