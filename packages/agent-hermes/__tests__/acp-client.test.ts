import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcpTimeoutError, HermesAcpClient } from "../src/acp-client.js";
import { DEFAULT_PROMPT_TIMEOUT_MS } from "../src/timeout.js";

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

describe("HermesAcpClient — promptTimeoutMs", () => {
  it("defaults to DEFAULT_PROMPT_TIMEOUT_MS when no value is passed", () => {
    const client = new HermesAcpClient();
    expect((client as unknown as { promptTimeoutMs: number }).promptTimeoutMs).toBe(
      DEFAULT_PROMPT_TIMEOUT_MS,
    );
  });

  it("stores the value passed to the constructor", () => {
    const client = new HermesAcpClient(300_000);
    expect((client as unknown as { promptTimeoutMs: number }).promptTimeoutMs).toBe(300_000);
  });
});

describe("HermesAcpClient — prompt timeout suspend output", () => {
  it("emits suspend output with minutes derived from promptTimeoutMs", async () => {
    const client = new HermesAcpClient(300_000); // 5 minutes
    // Inject a fake session id and stub sendRequest to simulate a timeout.
    (client as unknown as { sessionId: string }).sessionId = "session-x";
    (
      client as unknown as {
        sendRequest: (
          method: string,
          params: Record<string, unknown>,
          timeoutMs: number,
        ) => Promise<unknown>;
      }
    ).sendRequest = async () => {
      throw new AcpTimeoutError("simulated timeout");
    };

    const result = await client.prompt("hi");
    expect(result.text).toContain("$SUSPEND");
    expect(result.text).toContain("hermes prompt timed out after 5 minutes");
    expect(result.usage).toBeNull();
    expect(result.sessionId).toBe("session-x");
  });

  it("default-constructed client reports 10 minutes on timeout", async () => {
    const client = new HermesAcpClient();
    (client as unknown as { sessionId: string }).sessionId = "session-y";
    (
      client as unknown as {
        sendRequest: (
          method: string,
          params: Record<string, unknown>,
          timeoutMs: number,
        ) => Promise<unknown>;
      }
    ).sendRequest = async () => {
      throw new AcpTimeoutError("simulated timeout");
    };

    const result = await client.prompt("hi");
    expect(result.text).toContain("hermes prompt timed out after 10 minutes");
  });
});
