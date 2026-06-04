import { getSchema, validate } from "@ocas/core";

import type { CasRef, ModelAlias, WorkflowConfig } from "@united-workforce/protocol";
import { createAgentStore } from "./storage.js";

export type ResolvedLlmProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve model alias for extract: modelOverrides.extract → models.extract → defaultModel. */
export function resolveExtractModelAlias(config: WorkflowConfig): ModelAlias {
  const fromOverride = config.modelOverrides?.extract ?? null;
  if (fromOverride !== null) {
    return fromOverride;
  }
  if (config.models.extract !== undefined) {
    return "extract";
  }
  if (config.models.default !== undefined) {
    return "default";
  }
  return config.defaultModel;
}

export function resolveModel(config: WorkflowConfig, alias: ModelAlias): ResolvedLlmProvider {
  const modelEntry = config.models[alias];
  if (modelEntry === undefined) {
    throw new Error(`unknown model alias: ${alias}`);
  }
  const providerEntry = config.providers[modelEntry.provider];
  if (providerEntry === undefined) {
    throw new Error(`unknown provider "${modelEntry.provider}" for model "${alias}"`);
  }
  const apiKey = providerEntry.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`missing API key for provider: ${modelEntry.provider}`);
  }
  return {
    baseUrl: providerEntry.baseUrl,
    apiKey,
    model: modelEntry.name,
  };
}

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function extractJsonFromAssistantText(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const candidate = fenceMatch !== null ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(candidate) as unknown;
}

function parseAssistantText(parsed: unknown): string {
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
  const content = messageObj.content;
  if (typeof content !== "string") {
    throw new Error("LLM message has no text content");
  }
  return content;
}

async function chatCompletionText(
  provider: ResolvedLlmProvider,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(chatUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        response_format: { type: "json_object" },
      }),
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

  return parseAssistantText(parsed);
}

export type ExtractResult = {
  value: unknown;
  hash: CasRef;
};

/**
 * Call an OpenAI-compatible LLM to extract structured output matching outputSchema.
 * Loads config.yaml from the workflow storage root.
 */
export async function extract(
  rawOutput: string,
  outputSchema: CasRef,
  config: WorkflowConfig,
  storageRoot: string,
  casDir: string,
): Promise<ExtractResult> {
  const { store } = await createAgentStore(storageRoot, casDir);
  const schema = getSchema(store, outputSchema);
  if (schema === null) {
    throw new Error(`output schema not found in CAS: ${outputSchema}`);
  }

  const modelAlias = resolveExtractModelAlias(config);
  const provider = resolveModel(config, modelAlias);

  const schemaText = JSON.stringify(schema, null, 2);
  const assistantText = await chatCompletionText(provider, [
    {
      role: "system",
      content:
        "Extract structured data from the agent output. Reply with a single JSON object only, no markdown or prose. The JSON must validate against this JSON Schema:\n" +
        schemaText,
    },
    {
      role: "user",
      content: rawOutput,
    },
  ]);

  let structured: unknown;
  try {
    structured = extractJsonFromAssistantText(assistantText);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`failed to parse extracted JSON: ${message}`);
  }

  const outputHash = await store.cas.put(outputSchema, structured);
  const node = store.cas.get(outputHash);
  if (node === null || !validate(store, node)) {
    throw new Error("extracted output failed JSON Schema validation");
  }

  return { value: structured, hash: outputHash };
}
