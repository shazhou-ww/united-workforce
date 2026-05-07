import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/v4";

import { createCasStore } from "../src/cas.js";
import { createContentMerkleNode, serializeMerkleNode } from "../src/merkle.js";
import { reactExtract } from "../src/react-extract.js";
import type { LlmProvider } from "../src/types.js";

const metaSchema = z.object({ seen: z.string() });

const provider: LlmProvider = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "test",
  model: "test",
};

describe("reactExtract", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("cas_get rounds then extract tool yields validated meta", async () => {
    const casDir = await mkdtemp(join(tmpdir(), "react-extract-"));
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

      const text = `## Agent Output\n${h}\n## Extraction Instruction\nExtract seen from CAS.`;
      const result = await reactExtract({
        text,
        schema: metaSchema,
        provider,
        cas,
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
    const casDir = await mkdtemp(join(tmpdir(), "react-extract-max-"));
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

      const result = await reactExtract({
        text: "## Agent Output\nnoop\n## Extraction Instruction\nExtract seen.",
        schema: metaSchema,
        provider,
        cas,
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
    const casDir = await mkdtemp(join(tmpdir(), "react-extract-pass-"));
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

      const result = await reactExtract({
        text: "## Agent Output\nok\n## Extraction Instruction\nExtract.",
        schema: metaSchema,
        provider,
        cas,
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
