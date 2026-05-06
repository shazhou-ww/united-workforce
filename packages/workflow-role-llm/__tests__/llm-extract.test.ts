import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";

import { llmExtract } from "../src/llm-extract.js";

describe("llmExtract", () => {
  const originalFetch = globalThis.fetch;

  test("parses tool call arguments and validates with the zod schema", async () => {
    const schema = z
      .object({
        name: z.string(),
        description: z.string(),
      })
      .describe("Extract sense metadata from plan");

    let capturedUrl: string | null = null;
    let capturedInit: RequestInit | null = null;

    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedInit = init ?? null;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "extract",
                        arguments: JSON.stringify({
                          name: "cpu-usage",
                          description: "CPU load",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    const result = await llmExtract({
      text: "some plan",
      schema,
      provider: {
        baseUrl: "https://example.com/v1",
        apiKey: "k",
        model: "m",
      },
      dryRun: false,
    });

    globalThis.fetch = originalFetch;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({ name: "cpu-usage", description: "CPU load" });

    expect(capturedUrl).toBe("https://example.com/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer k",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(capturedInit?.body as string) as {
      model: string;
      tool_choice: { function: { name: string } };
    };
    expect(body.model).toBe("m");
    expect(body.tool_choice.function.name).toBeDefined();
  });

  test("returns schema_validation_failed when arguments do not match the schema", async () => {
    const schema = z.object({ n: z.number() });

    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    { function: { name: "extract", arguments: JSON.stringify({ n: "oops" }) } },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await llmExtract({
      text: "x",
      schema,
      provider: { baseUrl: "https://example.com", apiKey: "k", model: "m" },
      dryRun: false,
    });

    globalThis.fetch = originalFetch;

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("schema_validation_failed");
  });

  test("dryRun skips fetch and returns schema-shaped stub values", async () => {
    let calls = 0;
    globalThis.fetch = () => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    const schema = z.object({ n: z.number() });
    const result = await llmExtract({
      text: "ignored",
      schema,
      provider: { baseUrl: "https://example.com", apiKey: "k", model: "m" },
      dryRun: true,
    });

    globalThis.fetch = originalFetch;

    expect(calls).toBe(0);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({ n: 0 });
  });
});
