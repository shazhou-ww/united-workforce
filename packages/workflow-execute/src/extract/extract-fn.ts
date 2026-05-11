import { type CasStore, getContentMerklePayload } from "@uncaged/workflow-cas";
import type { ExtractFn, ExtractResult, LlmProvider } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";

import { createCasReactor } from "../cas-reactor.js";

export type ExtractDeps = {
  cas: CasStore;
};

const MAX_REACT_ROUNDS = 10;

/**
 * Create an ExtractFn backed by an LLM provider.
 *
 * Internally runs a multi-turn ReAct loop with two tools (`cas_get` for traversing the
 * Merkle DAG and a schema-shaped extract tool); the loop also accepts a plain-JSON
 * assistant reply as a short-circuit, which covers the legacy "single" extraction path.
 */
export function createExtract(provider: LlmProvider, deps: ExtractDeps): ExtractFn {
  const reactor = createCasReactor(provider, deps.cas, {
    maxRounds: MAX_REACT_ROUNDS,
    systemPromptForStructuredTool: (structuredToolName) =>
      `You extract structured metadata from content. The content is from a CAS node. Use cas_get to read referenced nodes if needed. When ready, call the ${structuredToolName} tool with JSON matching the schema. You may instead reply with only a JSON object (no prose) when no tools are needed.`,
  });

  return async <T extends Record<string, unknown>>(
    schema: z.ZodType<T>,
    contentHash: string,
  ): Promise<ExtractResult<T>> => {
    const payload = await getContentMerklePayload(deps.cas, contentHash);
    if (payload === null) {
      throw new Error(`extract: missing CAS content node for hash ${contentHash}`);
    }
    const text = `${payload}\n\nExtract structured metadata according to the schema.`;
    const result = await reactor({
      thread: { cas: deps.cas },
      input: text,
      schema,
    });
    if (!result.ok) {
      throw new Error(`extract failed: ${result.error}`);
    }
    return {
      meta: result.value,
      contentPayload: payload,
      refs: [],
    };
  };
}
