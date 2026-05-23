import { describe, test, expect, mock, beforeEach } from "bun:test";

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

import { shouldNudge, executeTurnTools, runBuiltinLoop } from "../src/loop.js";

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
    expect(shouldNudge({ noTools: false, text: "---\nstatus: done", turn: 0, maxTurns: 5 })).toBe(false);
  });
  test("2.4 returns false on last turn", () => {
    expect(shouldNudge({ noTools: false, text: "some text", turn: 4, maxTurns: 5 })).toBe(false);
  });
  test("2.5 returns true on second-to-last turn", () => {
    expect(shouldNudge({ noTools: false, text: "some text", turn: 3, maxTurns: 5 })).toBe(true);
  });
  test("2.6 leading whitespace before --- suppresses nudge", () => {
    expect(shouldNudge({ noTools: false, text: "  ---\nstatus: done", turn: 0, maxTurns: 5 })).toBe(false);
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
    await executeTurnTools([{ id: "c1", name: "read_file", arguments: "{}" }], fakeToolCtx, messages, "/tmp", "sess");
    expect(messages[0].content).toBe("result-A");
  });
});

describe("runBuiltinLoop integration", () => {
  test("3.1 single text-only response returns finalText immediately", async () => {
    mockChatCompletionWithTools.mockResolvedValue({ content: "---\nstatus: done\n---", toolCalls: [] });
    const result = await runBuiltinLoop(makeOptions());
    expect(result.finalText).toBe("---\nstatus: done\n---");
    expect(result.turnCount).toBe(1);
  });
  test("3.2 noTools=true suppresses tool calls", async () => {
    mockChatCompletionWithTools.mockResolvedValue({ content: "ok", toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }] });
    const result = await runBuiltinLoop(makeOptions({ noTools: true }));
    expect(result.finalText).toBe("ok");
    expect(result.turnCount).toBe(1);
  });
  test("3.3 tool call followed by text response", async () => {
    mockChatCompletionWithTools
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }] })
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
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("frontmatter"),
    );
    expect(nudgeMsg).toBeDefined();
  });
  test("3.5 maxTurns exhaustion falls back to last assistant content", async () => {
    mockChatCompletionWithTools.mockResolvedValue({ content: "still thinking", toolCalls: [] });
    const result = await runBuiltinLoop(makeOptions({ maxTurns: 3 }));
    expect(result.finalText).toBe("still thinking");
  });
  test("3.6 original messages array is not mutated", async () => {
    mockChatCompletionWithTools.mockResolvedValue({ content: "---\nstatus: done\n---", toolCalls: [] });
    const original = [{ role: "system" as const, content: "sys" }];
    await runBuiltinLoop(makeOptions({ messages: original }));
    expect(original.length).toBe(1);
  });
});
