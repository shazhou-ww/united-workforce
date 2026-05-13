import { describe, expect, test } from "bun:test";
import { ok, START, type ThreadContext, type WorkflowRuntime } from "@uncaged/workflow-protocol";
import type { LlmFn, ToolDefinition } from "@uncaged/workflow-reactor";
import * as z from "zod/v4";

import { createReactAdapter } from "../src/create-react-adapter.js";
import type { ReactAdapterConfig } from "../src/types.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeThread(prompt: string): ThreadContext {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    bundleHash: "TESTHASH00001",
    start: {
      role: START,
      content: prompt,
      meta: {},
      timestamp: Date.now(),
      parentState: null,
    },
    steps: [],
  };
}

const STUB_RUNTIME: WorkflowRuntime = {
  cas: {
    put: async (_content: string) => "STUBHASH",
    get: async (_hash: string) => null,
    delete: async (_hash: string) => {},
    list: async () => [],
  },
  extract: async (_schema, _contentHash) => ({
    meta: {},
    contentPayload: "",
    refs: [],
  }),
};

const TEST_SCHEMA = z
  .object({
    summary: z.string(),
    score: z.number(),
  })
  .meta({ title: "resolve", description: "Submit the final result." });

function makeChatResponse(content: string | null, toolCalls: unknown[] | null): string {
  const message: Record<string, unknown> = { role: "assistant" };
  if (content !== null) {
    message.content = content;
  }
  if (toolCalls !== null) {
    message.tool_calls = toolCalls;
  }
  return JSON.stringify({ choices: [{ message }] });
}

function makeToolCallResponse(name: string, args: Record<string, unknown>, id: string): string {
  return makeChatResponse(null, [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ]);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("createReactAdapter", () => {
  test("direct resolve: LLM immediately calls resolve tool with valid args", async () => {
    const llm: LlmFn = async (_input) => {
      return ok(makeToolCallResponse("resolve", { summary: "done", score: 42 }, "call_1"));
    };

    const config: ReactAdapterConfig = {
      llm,
      tools: [],
      toolHandler: async () => "unused",
      maxRounds: 5,
    };

    const adapter = createReactAdapter(config);
    const roleFn = adapter("You are a test agent.", TEST_SCHEMA);
    const result = await roleFn(makeThread("test task"), STUB_RUNTIME);

    expect(result.meta).toEqual({ summary: "done", score: 42 });
    expect(result.childThread).toBeNull();
  });

  test("tool call then resolve: LLM calls user tool first, then resolves", async () => {
    let callCount = 0;
    const llm: LlmFn = async (_input) => {
      callCount += 1;
      if (callCount === 1) {
        return ok(makeToolCallResponse("search", { query: "test" }, "call_1"));
      }
      return ok(makeToolCallResponse("resolve", { summary: "found it", score: 99 }, "call_2"));
    };

    const searchTool: ToolDefinition = {
      type: "function",
      function: {
        name: "search",
        description: "Search for information",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    };

    const toolResults: string[] = [];
    const config: ReactAdapterConfig = {
      llm,
      tools: [searchTool],
      toolHandler: async (name, args) => {
        toolResults.push(`${name}:${args}`);
        return "search result: found the answer";
      },
      maxRounds: 5,
    };

    const adapter = createReactAdapter(config);
    const roleFn = adapter("You are a test agent.", TEST_SCHEMA);
    const result = await roleFn(makeThread("test task"), STUB_RUNTIME);

    expect(result.meta).toEqual({ summary: "found it", score: 99 });
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toContain("search:");
  });

  test("plain JSON response accepted", async () => {
    const llm: LlmFn = async (_input) => {
      return ok(makeChatResponse(JSON.stringify({ summary: "plain", score: 7 }), null));
    };

    const config: ReactAdapterConfig = {
      llm,
      tools: [],
      toolHandler: async () => "unused",
      maxRounds: 5,
    };

    const adapter = createReactAdapter(config);
    const roleFn = adapter("You are a test agent.", TEST_SCHEMA);
    const result = await roleFn(makeThread("test task"), STUB_RUNTIME);

    expect(result.meta).toEqual({ summary: "plain", score: 7 });
  });

  test("schema validation failure + retry: invalid args then valid args", async () => {
    let callCount = 0;
    const llm: LlmFn = async (_input) => {
      callCount += 1;
      if (callCount === 1) {
        // Invalid: score should be number, not string
        return ok(
          makeToolCallResponse("resolve", { summary: "bad", score: "not-a-number" }, "call_1"),
        );
      }
      return ok(makeToolCallResponse("resolve", { summary: "fixed", score: 10 }, "call_2"));
    };

    const config: ReactAdapterConfig = {
      llm,
      tools: [],
      toolHandler: async () => "unused",
      maxRounds: 5,
    };

    const adapter = createReactAdapter(config);
    const roleFn = adapter("You are a test agent.", TEST_SCHEMA);
    const result = await roleFn(makeThread("test task"), STUB_RUNTIME);

    expect(result.meta).toEqual({ summary: "fixed", score: 10 });
    expect(callCount).toBe(2);
  });

  test("max rounds exceeded: throws error", async () => {
    const searchTool: ToolDefinition = {
      type: "function",
      function: {
        name: "search",
        description: "Search",
        parameters: { type: "object", properties: {}, required: [] },
      },
    };

    const llm: LlmFn = async (_input) => {
      // Always call search, never resolve
      return ok(makeToolCallResponse("search", {}, "call_n"));
    };

    const config: ReactAdapterConfig = {
      llm,
      tools: [searchTool],
      toolHandler: async () => "still searching...",
      maxRounds: 3,
    };

    const adapter = createReactAdapter(config);
    const roleFn = adapter("You are a test agent.", TEST_SCHEMA);

    await expect(roleFn(makeThread("test task"), STUB_RUNTIME)).rejects.toThrow(
      "max_react_rounds_exceeded",
    );
  });
});
