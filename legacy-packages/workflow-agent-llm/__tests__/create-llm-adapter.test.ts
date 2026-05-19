import { describe, expect, test } from "bun:test";
import {
  type CasStore,
  type ExtractFn,
  START,
  type ThreadContext,
  type WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import * as z from "zod";

import { createLlmAdapter } from "../src/create-llm-adapter.js";

function makeCtx(userContent: string): ThreadContext {
  return {
    start: {
      role: START,
      content: userContent,
      meta: {},
      timestamp: 1,
      parentState: null,
    },
    depth: 0,
    bundleHash: "TESTHASH00001",
    steps: [],
    threadId: "01TEST000000000000000000TR",
  };
}

const testSchema = z.object({ summary: z.string() });

function makeRuntime(): WorkflowRuntime {
  let stored = "";
  const cas: CasStore = {
    put: async (content: string) => {
      stored = content;
      return "HASH001";
    },
    get: async () => stored,
    delete: async () => {},
    list: async () => [],
  };
  const extract: ExtractFn = async (_schema, _contentHash) => ({
    meta: { summary: "extracted" },
    contentPayload: stored,
    refs: [],
  });
  return { cas, extract };
}

describe("createLlmAdapter", () => {
  const originalFetch = globalThis.fetch;

  test("posts system + user (start.content) and returns typed meta with childThread: null", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "model reply" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )) as unknown as typeof fetch;

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);
    const roleFn = adapter("system instructions", testSchema);
    const result = await roleFn(makeCtx("trigger text"), makeRuntime());

    globalThis.fetch = originalFetch;

    expect(result.meta).toEqual({ summary: "extracted" });
    expect(result.childThread).toBeNull();
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
    const roleFn = adapter("system", testSchema);

    await expect(roleFn(makeCtx("hi"), makeRuntime())).rejects.toThrow("llm:");
    globalThis.fetch = originalFetch;
  });

  test("throws on fetch network failure", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;

    const provider = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };
    const adapter = createLlmAdapter(provider);
    const roleFn = adapter("system", testSchema);

    await expect(roleFn(makeCtx("hi"), makeRuntime())).rejects.toThrow();
    globalThis.fetch = originalFetch;
  });
});
