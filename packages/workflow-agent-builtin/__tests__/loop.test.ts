import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockChatCompletionWithTools = mock(async () => ({
  content: "---\nstatus: done\n---",
  toolCalls: [],
}));
const mockAppendSessionTurn = mock(async () => {});
const mockExecuteBuiltinTool = mock(async () => "tool-result");

mock.module("../src/llm/index.js", () => ({
  chatCompletionWithTools: mockChatCompletionWithTools,
}));
mock.module("../src/session.js", () => ({
  appendSessionTurn: mockAppendSessionTurn,
}));
mock.module("../src/tools/index.js", () => ({
  builtinToolsToOpenAi: () => [],
  executeBuiltinTool: mockExecuteBuiltinTool,
  getBuiltinTools: () => [],
}));

import {
  executeTurnTools,
  extractFinalText,
  runBuiltinLoop,
  shouldInjectDeadlineWarning,
  shouldNudge,
  shouldProcessToolCalls,
} from "../src/loop.js";

const fakeProvider = {} as any;
const fakeToolCtx = {} as any;

function makeOptions(overrides: Partial<Parameters<typeof runBuiltinLoop>[0]> = {}) {
  return {
    provider: fakeProvider,
    messages: [{ role: "system" as const, content: "sys" }],
    toolCtx: fakeToolCtx,
    maxTurns: 5,
    storageRoot: "/tmp",
    sessionId: "sess",
    noTools: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockChatCompletionWithTools.mockReset();
  mockAppendSessionTurn.mockReset();
  mockExecuteBuiltinTool.mockReset();
});

describe("shouldNudge", () => {
  test("2.1 returns true when all conditions met", () => {
    expect(shouldNudge({ noTools: false, text: "some text", turn: 0, maxTurns: 5 })).toBe(true);
  });
  test("2.2 returns false when noTools=true", () => {
    expect(shouldNudge({ noTools: true, text: "some text", turn: 0, maxTurns: 5 })).toBe(false);
  });
  test("2.3 returns false when text starts with ---", () => {
    expect(shouldNudge({ noTools: false, text: "---\nstatus: done", turn: 0, maxTurns: 5 })).toBe(
      false,
    );
  });
  test("2.4 returns false on last turn", () => {
    expect(shouldNudge({ noTools: false, text: "some text", turn: 4, maxTurns: 5 })).toBe(false);
  });
  test("2.5 returns true on second-to-last turn", () => {
    expect(shouldNudge({ noTools: false, text: "some text", turn: 3, maxTurns: 5 })).toBe(true);
  });
  test("2.6 leading whitespace before --- suppresses nudge", () => {
    expect(shouldNudge({ noTools: false, text: "  ---\nstatus: done", turn: 0, maxTurns: 5 })).toBe(
      false,
    );
  });
});

describe("executeTurnTools", () => {
  test("4.1 executes each tool call and pushes tool result messages", async () => {
    mockExecuteBuiltinTool.mockResolvedValue("result");
    const messages: any[] = [];
    const calls = [
      { id: "c1", name: "tool_a", arguments: "{}" },
      { id: "c2", name: "tool_b", arguments: "{}" },
    ];
    const count = await executeTurnTools(calls, fakeToolCtx, messages, "/tmp", "sess");
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("tool");
    expect(messages[1].role).toBe("tool");
    expect(count).toBe(2);
  });
  test("4.2 tool result content matches executeBuiltinTool return value", async () => {
    mockExecuteBuiltinTool.mockResolvedValue("result-A");
    const messages: any[] = [];
    await executeTurnTools(
      [{ id: "c1", name: "read_file", arguments: "{}" }],
      fakeToolCtx,
      messages,
      "/tmp",
      "sess",
    );
    expect(messages[0].content).toBe("result-A");
  });
});

describe("runBuiltinLoop integration", () => {
  test("3.1 single text-only response returns finalText immediately", async () => {
    mockChatCompletionWithTools.mockResolvedValue({
      content: "---\nstatus: done\n---",
      toolCalls: [],
    });
    const result = await runBuiltinLoop(makeOptions());
    expect(result.finalText).toBe("---\nstatus: done\n---");
    expect(result.turnCount).toBe(1);
  });
  test("3.2 noTools=true suppresses tool calls", async () => {
    mockChatCompletionWithTools.mockResolvedValue({
      content: "ok",
      toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }],
    });
    const result = await runBuiltinLoop(makeOptions({ noTools: true }));
    expect(result.finalText).toBe("ok");
    expect(result.turnCount).toBe(1);
  });
  test("3.3 tool call followed by text response", async () => {
    mockChatCompletionWithTools
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }],
      })
      .mockResolvedValueOnce({ content: "---\nstatus: done\n---", toolCalls: [] });
    mockExecuteBuiltinTool.mockResolvedValue("file contents");
    const result = await runBuiltinLoop(makeOptions());
    expect(result.finalText).toBe("---\nstatus: done\n---");
    expect(result.turnCount).toBe(3);
  });
  test("3.4 nudge cycle inserts nudge message", async () => {
    mockChatCompletionWithTools
      .mockResolvedValueOnce({ content: "I am thinking", toolCalls: [] })
      .mockResolvedValueOnce({ content: "---\nstatus: done\n---", toolCalls: [] });
    const result = await runBuiltinLoop(makeOptions());
    expect(result.finalText).toBe("---\nstatus: done\n---");
    const nudgeMsg = result.messages.find(
      (m) =>
        m.role === "user" && typeof m.content === "string" && m.content.includes("frontmatter"),
    );
    expect(nudgeMsg).toBeDefined();
  });
  test("3.5 maxTurns exhaustion falls back to last assistant content", async () => {
    mockChatCompletionWithTools.mockResolvedValue({ content: "still thinking", toolCalls: [] });
    const result = await runBuiltinLoop(makeOptions({ maxTurns: 3 }));
    expect(result.finalText).toBe("still thinking");
  });
  test("3.6 original messages array is not mutated", async () => {
    mockChatCompletionWithTools.mockResolvedValue({
      content: "---\nstatus: done\n---",
      toolCalls: [],
    });
    const original = [{ role: "system" as const, content: "sys" }];
    await runBuiltinLoop(makeOptions({ messages: original }));
    expect(original.length).toBe(1);
  });
});

describe("shouldInjectDeadlineWarning", () => {
  test("5.1 returns true when turn count reaches warning threshold and not yet warned", () => {
    expect(shouldInjectDeadlineWarning(7, 10, false, false)).toBe(true);
  });
  test("5.2 returns false when already warned", () => {
    expect(shouldInjectDeadlineWarning(7, 10, true, false)).toBe(false);
  });
  test("5.3 returns false when noTools is true", () => {
    expect(shouldInjectDeadlineWarning(7, 10, false, true)).toBe(false);
  });
  test("5.4 returns false when turns remaining > DEADLINE_WARNING_TURNS", () => {
    expect(shouldInjectDeadlineWarning(5, 10, false, false)).toBe(false);
  });
  test("5.5 returns true when exactly at warning threshold", () => {
    expect(shouldInjectDeadlineWarning(7, 10, false, false)).toBe(true);
  });
  test("5.6 returns false when turns remaining is 0", () => {
    expect(shouldInjectDeadlineWarning(10, 10, false, false)).toBe(false);
  });
});

describe("shouldProcessToolCalls", () => {
  test("6.1 returns true when toolCalls present and noTools=false", () => {
    expect(shouldProcessToolCalls([{ id: "x", name: "read", arguments: "{}" }], false)).toBe(true);
  });
  test("6.2 returns false when toolCalls is null", () => {
    expect(shouldProcessToolCalls(null, false)).toBe(false);
  });
  test("6.3 returns false when toolCalls is empty array", () => {
    expect(shouldProcessToolCalls([], false)).toBe(false);
  });
  test("6.4 returns false when noTools=true", () => {
    expect(shouldProcessToolCalls([{ id: "x", name: "read", arguments: "{}" }], true)).toBe(false);
  });
  test("6.5 returns true when multiple tool calls present", () => {
    expect(
      shouldProcessToolCalls(
        [
          { id: "x1", name: "read", arguments: "{}" },
          { id: "x2", name: "write", arguments: "{}" },
        ],
        false,
      ),
    ).toBe(true);
  });
});

describe("extractFinalText", () => {
  test("7.1 returns last assistant message content", () => {
    const messages = [
      { role: "system" as const, content: "sys", tool_calls: null },
      { role: "assistant" as const, content: "first", tool_calls: null },
      { role: "assistant" as const, content: "last", tool_calls: null },
    ];
    expect(extractFinalText(messages)).toBe("last");
  });
  test("7.2 returns empty string when no assistant messages", () => {
    expect(extractFinalText([{ role: "system" as const, content: "sys", tool_calls: null }])).toBe(
      "",
    );
  });
  test("7.3 skips assistant messages with null content", () => {
    const messages = [
      { role: "assistant" as const, content: "first", tool_calls: null },
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [{ id: "x", name: "t", arguments: "{}" }],
      },
      { role: "assistant" as const, content: "second", tool_calls: null },
    ];
    expect(extractFinalText(messages)).toBe("second");
  });
  test("7.4 skips assistant messages with empty content", () => {
    const messages = [
      { role: "assistant" as const, content: "first", tool_calls: null },
      { role: "assistant" as const, content: "", tool_calls: null },
      { role: "user" as const, content: "nudge", tool_calls: null },
    ];
    expect(extractFinalText(messages)).toBe("first");
  });
  test("7.5 handles empty messages array", () => {
    expect(extractFinalText([])).toBe("");
  });
  test("7.6 handles messages with only user and system roles", () => {
    const messages = [
      { role: "system" as const, content: "sys", tool_calls: null },
      { role: "user" as const, content: "query", tool_calls: null },
    ];
    expect(extractFinalText(messages)).toBe("");
  });
});
