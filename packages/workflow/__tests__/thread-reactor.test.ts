import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmProvider } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";
import { createCasStore } from "../src/cas/cas.js";
import { createContentMerkleNode, serializeMerkleNode } from "../src/cas/merkle.js";
import { extractFunctionToolFromZodSchema } from "../src/extract/llm-extract.js";
import { createLlmFn, createThreadReactor } from "../src/reactor/index.js";

const metaSchema = z.object({ seen: z.string() });

const provider: LlmProvider = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "test",
  model: "test",
};

const CAS_GET_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "cas_get",
    description: "Read CAS node",
    parameters: {
      type: "object",
      properties: {
        hash: { type: "string", description: "hash" },
      },
      required: ["hash"],
    },
  },
};

type ThreadCtx = { cas: ReturnType<typeof createCasStore> };

function createTestReactor() {
  const llm = createLlmFn(provider);
  return createThreadReactor<ThreadCtx>({
    llm,
    maxRounds: 10,
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
      `Extract metadata. Use cas_get when needed. Call ${structuredToolName} with JSON args matching the schema, or reply with plain JSON.`,
    toolHandler: async (call, thread) => {
      if (call.function.name !== "cas_get") {
        return `unexpected tool ${call.function.name}`;
      }
      const ta = JSON.parse(call.function.arguments) as { hash: string };
      const blob = await thread.cas.get(ta.hash);
      return blob === null ? "null" : blob;
    },
  });
}

describe("createThreadReactor (extract-shaped)", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("cas_get rounds then extract tool yields validated meta", async () => {
    const casDir = await mkdtemp(join(tmpdir(), "thread-reactor-"));
    const cas = createCasStore(casDir);
    try {
      const blob = serializeMerkleNode(createContentMerkleNode("needle"));
      const h = await cas.put(blob);

      const origFetch = globalThis.fetch;
      let round = 0;
      restoreFetch = () => {
        globalThis.fetch = origFetch;
      };
      globalThis.fetch = Object.assign(
        async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
          round += 1;
          if (round === 1) {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      tool_calls: [
                        {
                          id: "t1",
                          type: "function",
                          function: {
                            name: "cas_get",
                            arguments: JSON.stringify({ hash: h }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: "t2",
                        type: "function",
                        function: {
                          name: "extract",
                          arguments: JSON.stringify({ seen: "needle" }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
        { preconnect: origFetch.preconnect.bind(origFetch) },
      ) as typeof fetch;

      const reactor = createTestReactor();
      const text = `## Agent Output\n${h}\n## Extraction Instruction\nExtract seen from CAS.`;
      const result = await reactor({
        thread: { cas },
        input: text,
        schema: metaSchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value).toEqual({ seen: "needle" });
      expect(round).toBe(2);
    } finally {
      await rm(casDir, { recursive: true, force: true });
    }
  });

  test("stops after max tool rounds when model keeps calling cas_get", async () => {
    const casDir = await mkdtemp(join(tmpdir(), "thread-reactor-max-"));
    const cas = createCasStore(casDir);
    try {
      const blob = serializeMerkleNode(createContentMerkleNode("x"));
      const h = await cas.put(blob);

      const origFetch = globalThis.fetch;
      let round = 0;
      restoreFetch = () => {
        globalThis.fetch = origFetch;
      };
      globalThis.fetch = Object.assign(
        async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
          round += 1;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: `loop-${round}`,
                        type: "function",
                        function: {
                          name: "cas_get",
                          arguments: JSON.stringify({ hash: h }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
        { preconnect: origFetch.preconnect.bind(origFetch) },
      ) as typeof fetch;

      const reactor = createTestReactor();
      const result = await reactor({
        thread: { cas },
        input: "## Agent Output\nnoop\n## Extraction Instruction\nExtract seen.",
        schema: metaSchema,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error).toBe("max_react_rounds_exceeded");
      expect(round).toBe(10);
    } finally {
      await rm(casDir, { recursive: true, force: true });
    }
  });

  test("passthrough JSON assistant message without tool calls", async () => {
    const casDir = await mkdtemp(join(tmpdir(), "thread-reactor-pass-"));
    const cas = createCasStore(casDir);
    try {
      const origFetch = globalThis.fetch;
      restoreFetch = () => {
        globalThis.fetch = origFetch;
      };
      globalThis.fetch = Object.assign(
        async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '{"seen":"direct"}',
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        { preconnect: origFetch.preconnect.bind(origFetch) },
      ) as typeof fetch;

      const reactor = createTestReactor();
      const result = await reactor({
        thread: { cas },
        input: "## Agent Output\nok\n## Extraction Instruction\nExtract.",
        schema: metaSchema,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value).toEqual({ seen: "direct" });
    } finally {
      await rm(casDir, { recursive: true, force: true });
    }
  });
});
