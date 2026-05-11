import { type CasStore, getContentMerklePayload } from "@uncaged/workflow-cas";
import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
import type { ExtractFn, ExtractResult, LlmProvider } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { extractFunctionToolFromZodSchema } from "./llm-extract.js";

export type ExtractDeps = {
  cas: CasStore;
};

const MAX_REACT_ROUNDS = 10;

const CAS_GET_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "cas_get",
    description:
      "Read a Merkle DAG node from content-addressed storage by its hash. Returns YAML-formatted node with type, payload, and refs or children fields (content nodes use refs).",
    parameters: {
      type: "object",
      properties: {
        hash: { type: "string", description: "The CAS hash to retrieve" },
      },
      required: ["hash"],
    },
  },
};

type ExtractThreadContext = {
  cas: CasStore;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Create an ExtractFn backed by an LLM provider.
 *
 * Internally runs a multi-turn ReAct loop with two tools (`cas_get` for traversing the
 * Merkle DAG and a schema-shaped extract tool); the loop also accepts a plain-JSON
 * assistant reply as a short-circuit, which covers the legacy "single" extraction path.
 */
export function createExtract(provider: LlmProvider, deps: ExtractDeps): ExtractFn {
  const llm = createLlmFn(provider);
  const reactor = createThreadReactor<ExtractThreadContext>({
    llm,
    maxRounds: MAX_REACT_ROUNDS,
    staticTools: [CAS_GET_TOOL_DEFINITION],
    structuredToolFromSchema: (schema) => {
      const t = extractFunctionToolFromZodSchema(schema);
      return {
        name: t.name,
        tool: {
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        },
      };
    },
    systemPromptForStructuredTool: (structuredToolName) =>
      `You extract structured metadata from content. The content is from a CAS node. Use cas_get to read referenced nodes if needed. When ready, call the ${structuredToolName} tool with JSON matching the schema. You may instead reply with only a JSON object (no prose) when no tools are needed.`,
    toolHandler: async (call, thread) => {
      if (call.function.name !== "cas_get") {
        return `Unexpected tool routed to handler: ${call.function.name}`;
      }
      let hash: string;
      try {
        const ta = JSON.parse(call.function.arguments) as unknown;
        if (!isRecord(ta) || typeof ta.hash !== "string") {
          return 'cas_get requires a JSON object with a string "hash" field.';
        }
        hash = ta.hash;
      } catch {
        return 'cas_get arguments were not valid JSON. Provide {"hash": "<cas-hash>"}.';
      }
      const blob = await thread.cas.get(hash);
      return blob === null ? "null" : blob;
    },
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
