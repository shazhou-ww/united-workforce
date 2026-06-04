import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HermesAcpClient } from "../src/acp-client.js";

describe("handleSessionUpdate — text extraction", () => {
  let client: HermesAcpClient;

  beforeEach(() => {
    client = new HermesAcpClient();
  });

  afterEach(async () => {
    await client.close();
  });

  it("agent_message_chunk accumulates text in messageChunks", () => {
    (
      client as unknown as { handleSessionUpdate: (u: Record<string, unknown>) => void }
    ).handleSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });
    (
      client as unknown as { handleSessionUpdate: (u: Record<string, unknown>) => void }
    ).handleSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " world" },
    });
    expect((client as unknown as { messageChunks: string[] }).messageChunks).toEqual([
      "hello",
      " world",
    ]);
  });

  it("non-text chunks and other update types are ignored", () => {
    (
      client as unknown as { handleSessionUpdate: (u: Record<string, unknown>) => void }
    ).handleSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", text: "ignored" },
    });
    (
      client as unknown as { handleSessionUpdate: (u: Record<string, unknown>) => void }
    ).handleSessionUpdate({
      sessionUpdate: "tool_call",
      title: "Bash",
      toolCallId: "tc-1",
    });
    (
      client as unknown as { handleSessionUpdate: (u: Record<string, unknown>) => void }
    ).handleSessionUpdate({ sessionUpdate: "unknown_type", data: {} });
    expect((client as unknown as { messageChunks: string[] }).messageChunks).toHaveLength(0);
  });
});
