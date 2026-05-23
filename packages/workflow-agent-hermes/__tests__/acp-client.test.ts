import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { HermesAcpClient } from "../src/acp-client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("handleSessionUpdate — helper extraction", () => {
  let client: HermesAcpClient;

  beforeEach(() => {
    client = new HermesAcpClient();
  });

  afterEach(async () => {
    await client.close();
  });

  it("agent_message_chunk accumulates text in messageChunks", () => {
    (client as any).handleSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });
    (client as any).handleSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " world" },
    });
    expect((client as any).messageChunks).toEqual(["hello", " world"]);
  });

  it("agent_thought_chunk accumulates reasoning in reasoningChunks", () => {
    (client as any).handleSessionUpdate({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    });
    expect((client as any).reasoningChunks).toEqual(["thinking"]);
  });

  it("tool_call registers a pending tool and flushes message chunks", () => {
    (client as any).messageChunks = ["pre-tool text"];
    (client as any).handleSessionUpdate({
      sessionUpdate: "tool_call",
      title: "Bash",
      rawInput: { command: "ls" },
      toolCallId: "tc-1",
    });
    expect((client as any).pendingTools.get("tc-1")).toEqual({
      name: "Bash",
      args: JSON.stringify({ command: "ls" }),
    });
    expect((client as any).messageChunks).toEqual([]);
    expect((client as any).messages).toHaveLength(1);
    expect((client as any).messages[0].role).toBe("assistant");
  });

  it("tool_call_update completed pushes tool_call and tool messages", () => {
    (client as any).pendingTools.set("tc-2", { name: "Read", args: '{"path":"/foo"}' });
    (client as any).handleSessionUpdate({
      sessionUpdate: "tool_call_update",
      status: "completed",
      toolCallId: "tc-2",
      rawOutput: "file contents",
    });
    const msgs = (client as any).messages as Array<{
      role: string;
      tool_calls: unknown;
      content: string | null;
    }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].tool_calls).toEqual([
      { function: { name: "Read", arguments: '{"path":"/foo"}' } },
    ]);
    expect(msgs[1].role).toBe("tool");
    expect(msgs[1].content).toBe("file contents");
    expect((client as any).pendingTools.has("tc-2")).toBe(false);
  });

  it("tool_call_update with non-string rawOutput JSON-stringifies it", () => {
    (client as any).pendingTools.set("tc-3", { name: "Fetch", args: "" });
    (client as any).handleSessionUpdate({
      sessionUpdate: "tool_call_update",
      status: "completed",
      toolCallId: "tc-3",
      rawOutput: { html: "<p>page</p>" },
    });
    const msgs = (client as any).messages as Array<{ role: string; content: string | null }>;
    expect(msgs[1].content).toBe(JSON.stringify({ html: "<p>page</p>" }));
  });

  it("unknown updateType is a no-op", () => {
    (client as any).handleSessionUpdate({ sessionUpdate: "unknown_type", data: {} });
    expect((client as any).messages).toHaveLength(0);
    expect((client as any).messageChunks).toHaveLength(0);
  });
});

describe("HermesAcpClient", () => {
  let client: HermesAcpClient;

  beforeEach(() => {
    client = new HermesAcpClient();
  });

  afterEach(async () => {
    await client.close();
  });

  it(
    "connect() returns a UUID sessionId",
    async () => {
      const sessionId = await client.connect(process.cwd());
      expect(typeof sessionId).toBe("string");
      expect(sessionId).toMatch(UUID_RE);
    },
    { timeout: 2 * 60 * 1000 },
  );

  it(
    "prompt() returns a non-empty text response",
    async () => {
      await client.connect(process.cwd());
      const result = await client.prompt("Reply with exactly the word: PONG");
      expect(typeof result.text).toBe("string");
      expect(result.text.length).toBeGreaterThan(0);
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId).toMatch(UUID_RE);
    },
    { timeout: 2 * 60 * 1000 },
  );

  it(
    "prompt() can be called twice on the same session (resume)",
    async () => {
      await client.connect(process.cwd());

      const first = await client.prompt("Say the word ALPHA and nothing else.");
      expect(first.text.length).toBeGreaterThan(0);

      const second = await client.prompt("Now say the word BETA and nothing else.");
      expect(second.text.length).toBeGreaterThan(0);

      expect(first.sessionId).toBe(second.sessionId);
    },
    { timeout: 2 * 60 * 1000 },
  );

  // TODO(#435): flaky — depends on live LLM; mock or move to integration suite
  it.skip(
    "prompt() collects structured messages including tool calls",
    async () => {
      await client.connect(process.cwd());
      const result = await client.prompt("Run this command: echo TOOL_DETAIL_TEST");
      expect(result.messages.length).toBeGreaterThan(0);
      // Should have at least one tool message (the echo command)
      const toolMessages = result.messages.filter((m) => m.role === "tool");
      expect(toolMessages.length).toBeGreaterThan(0);
      // Tool message should contain the output
      const toolContent = toolMessages[0]?.content ?? "";
      expect(toolContent).toContain("TOOL_DETAIL_TEST");
      // Should have assistant messages with tool_calls
      const assistantWithTools = result.messages.filter(
        (m) => m.role === "assistant" && m.tool_calls !== null,
      );
      expect(assistantWithTools.length).toBeGreaterThan(0);
    },
    { timeout: 2 * 60 * 1000 },
  );
});
