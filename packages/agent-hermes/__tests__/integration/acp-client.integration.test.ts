import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
