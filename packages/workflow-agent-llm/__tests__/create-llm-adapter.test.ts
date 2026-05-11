import { describe, expect, test } from "bun:test";
import { type AgentContext, START } from "@uncaged/workflow-runtime";

import { createLlmAdapter } from "../src/create-llm-adapter.js";

function makeCtx(userContent: string): AgentContext {
  return {
    start: {
      role: START,
      content: userContent,
      meta: {},
      timestamp: 1,
    },
    depth: 0,
    steps: [],
    threadId: "01TEST000000000000000000TR",
    currentRole: { name: "planner", systemPrompt: "system instructions" },
  };
}

describe("createLlmAdapter", () => {
  const originalFetch = globalThis.fetch;

  test("posts system + user (start.content) and returns assistant text", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "model reply" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )) as unknown as typeof fetch;

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);
    const out = await adapter(makeCtx("trigger text"));

    globalThis.fetch = originalFetch;

    expect(out).toBe("model reply");
  });

  test("throws on non-ok fetch response", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      )) as unknown as typeof fetch;

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);

    await expect(adapter(makeCtx("hi"))).rejects.toThrow("llm:");
    globalThis.fetch = originalFetch;
  });

  test("throws on fetch network failure", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);

    await expect(adapter(makeCtx("hi"))).rejects.toThrow();
    globalThis.fetch = originalFetch;
  });
});
