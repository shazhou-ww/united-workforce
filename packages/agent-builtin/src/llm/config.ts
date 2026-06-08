import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

import type { ResolvedLlmProvider } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Path to the builtin agent's own config file inside a storage root. */
export function getBuiltinLlmConfigPath(storageRoot: string): string {
  return join(storageRoot, "agents", "builtin.yaml");
}

/**
 * Load the builtin agent's LLM endpoint config from
 * `<storageRoot>/agents/builtin.yaml`.
 *
 * The engine `config.yaml` is intentionally ignored — engine config is
 * LLM-free. Each adapter owns its own LLM configuration.
 *
 * Expected YAML shape:
 * ```yaml
 * provider:
 *   baseUrl: https://api.openai.com/v1
 *   apiKey: sk-...
 * model: gpt-4o-mini
 * ```
 */
export async function loadBuiltinLlmConfig(storageRoot: string): Promise<ResolvedLlmProvider> {
  const path = getBuiltinLlmConfigPath(storageRoot);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Failed to read builtin LLM config at agents/builtin.yaml: ${message}. ` +
        "Create this file with provider.baseUrl, provider.apiKey, and model fields.",
    );
  }

  const raw = parse(text) as unknown;
  if (!isRecord(raw)) {
    throw new Error(`agents/builtin.yaml root must be a mapping (got ${typeof raw})`);
  }

  const provider = raw.provider;
  if (!isRecord(provider)) {
    throw new Error("agents/builtin.yaml requires a provider mapping with baseUrl and apiKey");
  }

  const baseUrl = provider.baseUrl;
  if (typeof baseUrl !== "string" || baseUrl === "") {
    throw new Error("agents/builtin.yaml: provider.baseUrl must be a non-empty string");
  }

  const apiKey = provider.apiKey;
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new Error("agents/builtin.yaml: provider.apiKey must be a non-empty string");
  }

  const model = raw.model;
  if (typeof model !== "string" || model === "") {
    throw new Error("agents/builtin.yaml: model must be a non-empty string");
  }

  return { baseUrl, apiKey, model };
}
