import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";

import { extractMetaOrThrow } from "../src/extract-meta.js";

const provider = {
  baseUrl: "https://example.com/v1",
  apiKey: "k",
  model: "m",
};

describe("extractMetaOrThrow", () => {
  const originalFetch = globalThis.fetch;

  test("dryRun returns dryRunMeta without calling fetch", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    const schema = z.object({ n: z.number() });
    const out = await extractMetaOrThrow("r", "raw", schema, {
      provider,
      dryRun: true,
      dryRunMeta: { n: 7 },
    });

    globalThis.fetch = originalFetch;

    expect(calls).toBe(0);
    expect(out).toEqual({ n: 7 });
  });

  test("throws when extraction fails after retry", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    { function: { name: "extract", arguments: JSON.stringify({ n: "bad" }) } },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )) as unknown as typeof fetch;

    const schema = z.object({ n: z.number() });

    await expect(
      extractMetaOrThrow("plan", "text", schema, { provider, dryRun: false, dryRunMeta: { n: 0 } }),
    ).rejects.toThrow(/structured extraction failed after retry/);

    globalThis.fetch = originalFetch;
  });

  test("returns validated meta on successful tool call", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "extract",
                        arguments: JSON.stringify({ branch: "feat/x", message: "feat: y" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )) as unknown as typeof fetch;

    const schema = z.object({
      branch: z.string(),
      message: z.string(),
    });

    const out = await extractMetaOrThrow("committer-plan", "plan text", schema, {
      provider,
      dryRun: false,
      dryRunMeta: { branch: "", message: "" },
    });

    globalThis.fetch = originalFetch;

    expect(out).toEqual({ branch: "feat/x", message: "feat: y" });
  });
});
