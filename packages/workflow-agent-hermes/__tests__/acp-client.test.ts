import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { HermesAcpClient } from "../src/acp-client.js";

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
