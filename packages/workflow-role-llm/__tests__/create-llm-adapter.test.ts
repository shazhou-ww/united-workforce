import { describe, expect, test } from "bun:test";
import { START, type ThreadContext } from "@uncaged/workflow";

import { createLlmAdapter } from "../src/create-llm-adapter.js";

function makeCtx(userContent: string): ThreadContext {
  return {
    start: {
      role: START,
      content: userContent,
      meta: { maxRounds: 10 },
      timestamp: 1,
    },
    steps: [],
  };
}

describe("createLlmAdapter", () => {
  const originalFetch = globalThis.fetch;

  test("posts system + user (start.content) and returns assistant text", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "model reply" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);
    const out = await adapter(makeCtx("trigger text"), "system instructions");

    globalThis.fetch = originalFetch;

    expect(out).toBe("model reply");
  });

  test("throws on non-ok fetch response", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      );

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);

    await expect(adapter(makeCtx("hi"), "sys")).rejects.toThrow("llm:");
    globalThis.fetch = originalFetch;
  });

  test("throws on fetch network failure", async () => {
    globalThis.fetch = () => Promise.reject(new Error("ECONNREFUSED"));

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);

    await expect(adapter(makeCtx("hi"), "sys")).rejects.toThrow();
    globalThis.fetch = originalFetch;
  });
});
