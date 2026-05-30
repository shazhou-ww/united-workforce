import { describe, expect, test } from "bun:test";
import { createMemoryStore, walk } from "@uncaged/json-cas";
import {
  parseClaudeCodeJsonOutput,
  parseClaudeCodeStreamOutput,
  storeClaudeCodeDetail,
  storeClaudeCodeRawOutput,
} from "../src/session-detail.js";
import type { ClaudeCodeParsedResult } from "../src/types.js";

describe("parseClaudeCodeJsonOutput", () => {
  test("parses valid claude -p --output-format json output", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done fixing bug",
      session_id: "75e2167f-abc",
      num_turns: 3,
      total_cost_usd: 0.08,
      duration_ms: 10276,
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const parsed = parseClaudeCodeJsonOutput(stdout);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("result");
    expect(parsed!.subtype).toBe("success");
    expect(parsed!.result).toBe("Done fixing bug");
    expect(parsed!.sessionId).toBe("75e2167f-abc");
    expect(parsed!.numTurns).toBe(3);
    expect(parsed!.totalCostUsd).toBe(0.08);
    expect(parsed!.durationMs).toBe(10276);
    expect(parsed!.stopReason).toBe("end_turn");
    expect(parsed!.usage.inputTokens).toBe(100);
    expect(parsed!.usage.outputTokens).toBe(50);
    expect(parsed!.turns).toEqual([]);
  });

  test("returns null for non-JSON output", () => {
    const parsed = parseClaudeCodeJsonOutput("Some random text\nwithout JSON");
    expect(parsed).toBeNull();
  });

  test("returns null when session_id is missing", () => {
    const stdout = JSON.stringify({ type: "result", result: "hi", subtype: "success" });
    const parsed = parseClaudeCodeJsonOutput(stdout);
    expect(parsed).toBeNull();
  });
});

describe("parseClaudeCodeStreamOutput", () => {
  test("parses stream-json output with turns", () => {
    const lines = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-123",
        model: "claude-sonnet-4.5",
        tools: ["Bash", "Read"],
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll list the files." },
            { type: "tool_use", id: "tool_1", name: "Bash", input: { command: "ls" } },
          ],
        },
        session_id: "sess-123",
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool_1", content: "file1.ts\nfile2.ts" }],
        },
        session_id: "sess-123",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "There are 2 files." }],
        },
        session_id: "sess-123",
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "There are 2 files.",
        session_id: "sess-123",
        num_turns: 2,
        total_cost_usd: 0.05,
        duration_ms: 5000,
        stop_reason: "end_turn",
        usage: {
          input_tokens: 200,
          output_tokens: 30,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      }),
    ];
    const stdout = lines.join("\n");
    const parsed = parseClaudeCodeStreamOutput(stdout);

    expect(parsed).not.toBeNull();
    expect(parsed!.model).toBe("claude-sonnet-4.5");
    expect(parsed!.sessionId).toBe("sess-123");
    expect(parsed!.result).toBe("There are 2 files.");
    expect(parsed!.stopReason).toBe("end_turn");
    expect(parsed!.usage.inputTokens).toBe(200);
    expect(parsed!.usage.outputTokens).toBe(30);
    expect(parsed!.usage.cacheReadInputTokens).toBe(100);

    // Turns: assistant(text+tool), tool_result, assistant(text)
    expect(parsed!.turns).toHaveLength(3);
    expect(parsed!.turns[0]!.role).toBe("assistant");
    expect(parsed!.turns[0]!.content).toBe("I'll list the files.");
    expect(parsed!.turns[0]!.toolCalls).toHaveLength(1);
    expect(parsed!.turns[0]!.toolCalls![0]!.name).toBe("Bash");
    expect(parsed!.turns[1]!.role).toBe("tool_result");
    expect(parsed!.turns[1]!.content).toBe("file1.ts\nfile2.ts");
    expect(parsed!.turns[2]!.role).toBe("assistant");
    expect(parsed!.turns[2]!.content).toBe("There are 2 files.");
    expect(parsed!.turns[2]!.toolCalls).toBeNull();
  });

  test("returns null when no result line", () => {
    const stdout = JSON.stringify({ type: "system", model: "test" });
    expect(parseClaudeCodeStreamOutput(stdout)).toBeNull();
  });

  test("skips invalid JSON lines gracefully", () => {
    const lines = [
      "not json",
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "s1",
        num_turns: 1,
        total_cost_usd: 0.01,
        duration_ms: 1000,
        stop_reason: "end_turn",
        usage: {},
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.result).toBe("ok");
    expect(parsed!.turns).toHaveLength(0);
  });
});

describe("parseClaudeCodeStreamOutput — helper extraction", () => {
  test("processSystemLine sets model from system message", () => {
    const lines = [
      JSON.stringify({ type: "system", model: "claude-opus-4" }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "s1",
        num_turns: 0,
        total_cost_usd: 0,
        duration_ms: 0,
        stop_reason: "end_turn",
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.model).toBe("claude-opus-4");
  });

  test("processAssistantLine skips empty content", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "s1",
        num_turns: 0,
        total_cost_usd: 0,
        duration_ms: 0,
        stop_reason: "end_turn",
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.turns).toHaveLength(0);
  });

  test("processUserLine skips when no tool_result items", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "s1",
        num_turns: 0,
        total_cost_usd: 0,
        duration_ms: 0,
        stop_reason: "end_turn",
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.turns).toHaveLength(0);
  });

  test("turn indices are sequential across mixed assistant and user lines", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "A" }] },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "R" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "B" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "s1",
        num_turns: 3,
        total_cost_usd: 0,
        duration_ms: 0,
        stop_reason: "end_turn",
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.turns).toHaveLength(3);
    expect(parsed!.turns.map((t) => t.index)).toEqual([0, 1, 2]);
  });
});

describe("storeClaudeCodeDetail", () => {
  const baseParsed: ClaudeCodeParsedResult = {
    type: "result",
    subtype: "success",
    result: "The answer",
    sessionId: "abc-123",
    numTurns: 5,
    totalCostUsd: 0.12,
    durationMs: 15000,
    model: "claude-sonnet-4.5",
    stopReason: "end_turn",
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    turns: [
      { index: 0, role: "assistant", content: "hello", toolCalls: null },
      { index: 1, role: "tool_result", content: "world", toolCalls: null },
    ],
  };

  test("stores detail with per-turn CAS nodes", async () => {
    const store = createMemoryStore();
    const { detailHash, output, sessionId } = await storeClaudeCodeDetail(store, baseParsed);

    expect(detailHash).toHaveLength(13);
    expect(output).toBe("The answer");
    expect(sessionId).toBe("abc-123");

    const node = await store.get(detailHash);
    expect(node).not.toBeNull();
    expect(node!.payload.model).toBe("claude-sonnet-4.5");
    expect(node!.payload.stopReason).toBe("end_turn");
    expect(node!.payload.usage.inputTokens).toBe(100);
    expect(node!.payload.turns).toHaveLength(2);

    // Verify turn CAS nodes
    const turn0 = await store.get(node!.payload.turns[0]);
    expect(turn0).not.toBeNull();
    expect(turn0!.payload.role).toBe("assistant");
    expect(turn0!.payload.content).toBe("hello");
  });

  test("detail node is walkable from root", async () => {
    const store = createMemoryStore();
    const { detailHash } = await storeClaudeCodeDetail(store, baseParsed);
    const visited: string[] = [];
    walk(store, detailHash, (hash) => visited.push(hash));
    expect(visited.length).toBeGreaterThan(0);
  });
});

describe("parseClaudeCodeStreamOutput — incomplete output (no result line)", () => {
  test("Test 1.1: parses stream with turns but no result line", () => {
    const lines = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-incomplete-1",
        model: "claude-sonnet-4.5",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Starting work..." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "This is the last assistant message." }],
        },
      }),
    ];
    const stdout = lines.join("\n");
    const parsed = parseClaudeCodeStreamOutput(stdout);

    expect(parsed).not.toBeNull();
    expect(parsed!.subtype).toBe("incomplete");
    expect(parsed!.result).toBe("This is the last assistant message.");
    expect(parsed!.sessionId).toBe("sess-incomplete-1");
    expect(parsed!.model).toBe("claude-sonnet-4.5");
    expect(parsed!.turns).toHaveLength(2);
    expect(parsed!.stopReason).toBe("incomplete_no_result_line");
    expect(parsed!.numTurns).toBe(2);
    expect(parsed!.durationMs).toBe(0);
    expect(parsed!.totalCostUsd).toBe(0);
  });

  test("Test 1.2: parses stream with no turns and no result line", () => {
    const lines = [
      JSON.stringify({
        type: "system",
        session_id: "sess-no-turns",
        model: "claude-opus-4",
      }),
    ];
    const stdout = lines.join("\n");
    const parsed = parseClaudeCodeStreamOutput(stdout);

    expect(parsed).not.toBeNull();
    expect(parsed!.subtype).toBe("incomplete");
    expect(parsed!.result).toBe("");
    expect(parsed!.sessionId).toBe("sess-no-turns");
    expect(parsed!.model).toBe("claude-opus-4");
    expect(parsed!.turns).toHaveLength(0);
    expect(parsed!.stopReason).toBe("incomplete_no_result_line");
  });

  test("Test 1.3: returns null for completely empty output", () => {
    const parsed1 = parseClaudeCodeStreamOutput("");
    expect(parsed1).toBeNull();

    const parsed2 = parseClaudeCodeStreamOutput("   \n  \n  ");
    expect(parsed2).toBeNull();
  });

  test("Test 1.4: returns null for malformed JSON lines only", () => {
    const stdout = "not json\n{broken json\n[invalid";
    const parsed = parseClaudeCodeStreamOutput(stdout);
    expect(parsed).toBeNull();
  });

  test("Test 6.1: extracts from last assistant text-only turn", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s1", model: "test" }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "First message" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Last message" }] },
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.result).toBe("Last message");
  });

  test("Test 6.2: extracts from last assistant turn with tool calls", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s1", model: "test" }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Text with tools" },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.result).toBe("Text with tools");
  });

  test("Test 6.3: returns empty string when no assistant turns", () => {
    const lines = [JSON.stringify({ type: "system", session_id: "s1", model: "test" })];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.result).toBe("");
  });

  test("Test 6.4: extracts from most recent assistant turn before tool_result", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s1", model: "test" }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Before tool call" }] },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "tool output" }] },
      }),
    ];
    const parsed = parseClaudeCodeStreamOutput(lines.join("\n"));
    expect(parsed).not.toBeNull();
    expect(parsed!.result).toBe("Before tool call");
  });
});

describe("storeClaudeCodeDetail — incomplete results", () => {
  test("Test 4.1: stores incomplete result as detail", async () => {
    const store = createMemoryStore();
    const incompleteParsed: ClaudeCodeParsedResult = {
      type: "result",
      subtype: "incomplete",
      result: "Partial output",
      sessionId: "sess-incomplete",
      numTurns: 2,
      totalCostUsd: 0,
      durationMs: 0,
      model: "claude-sonnet-4.5",
      stopReason: "incomplete_no_result_line",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      turns: [
        { index: 0, role: "assistant", content: "Turn 1", toolCalls: null },
        { index: 1, role: "assistant", content: "Partial output", toolCalls: null },
      ],
    };

    const { detailHash, output, sessionId } = await storeClaudeCodeDetail(store, incompleteParsed);

    expect(detailHash).toHaveLength(13);
    expect(output).toBe("Partial output");
    expect(sessionId).toBe("sess-incomplete");

    const node = await store.get(detailHash);
    expect(node).not.toBeNull();
    expect(node!.payload.subtype).toBe("incomplete");
    expect(node!.payload.stopReason).toBe("incomplete_no_result_line");
    expect(node!.payload.turns).toHaveLength(2);
  });
});

describe("storeClaudeCodeRawOutput", () => {
  test("stores raw text when JSON parsing fails", async () => {
    const store = createMemoryStore();
    const rawText = "Claude produced plain text without JSON";
    const hash = await storeClaudeCodeRawOutput(store, rawText);
    expect(hash).toHaveLength(13);
    const node = await store.get(hash);
    expect(node).not.toBeNull();
    expect(node!.payload.text).toBe(rawText);
  });
});
