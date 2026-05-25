import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { HermesAcpClient } from "../../src/acp-client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const toolMessages = result.messages.filter((m) => m.role === "tool");
      expect(toolMessages.length).toBeGreaterThan(0);
      const toolContent = toolMessages[0]?.content ?? "";
      expect(toolContent).toContain("TOOL_DETAIL_TEST");
      const assistantWithTools = result.messages.filter(
        (m) => m.role === "assistant" && m.tool_calls !== null,
      );
      expect(assistantWithTools.length).toBeGreaterThan(0);
    },
    { timeout: 2 * 60 * 1000 },
  );
});
