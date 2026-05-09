import type { LlmProvider } from "@uncaged/workflow-runtime";

import { err, ok } from "../util/index.js";

import type { ChatMessage, LlmFn, ToolDefinition } from "./types.js";

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

/**
 * Wraps provider credentials into an {@link LlmFn}: single POST to chat/completions,
 * returns raw JSON body text or a {@link Result} error. Callers parse assistant messages.
 */
export function createLlmFn(provider: LlmProvider): LlmFn {
  return async ({
    messages,
    tools,
  }: {
    messages: ChatMessage[];
    tools: readonly ToolDefinition[];
  }) => {
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
  };
}
