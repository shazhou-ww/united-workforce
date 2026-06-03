import { afterEach, describe, expect, it } from 'vitest';
import { HermesAcpClient } from "../../src/acp-client.js";

/**
 * E2E test for cross-process session resume.
 *
 * Simulates the workflow re-entry scenario:
 * 1. Client A: connect → prompt → close (developer first run)
 * 2. Client B: resume(sessionId) → prompt (developer re-entry after reviewer reject)
 *
 * This is what happens when uwf thread step spawns uwf-hermes twice for the same role.
 */
describe("HermesAcpClient cross-process resume", () => {
  const clients: HermesAcpClient[] = [];

  afterEach(async () => {
    for (const c of clients) {
      await c.close();
    }
    clients.length = 0;
  });

  // TODO(#435): flaky — depends on live LLM; mock or move to integration suite
  it.skip(
    "resume() after close — second prompt returns non-empty text",
    async () => {
      // --- Client A: first run ---
      const clientA = new HermesAcpClient();
      clients.push(clientA);

      await clientA.connect(process.cwd());
      const first = await clientA.prompt(
        "Remember the secret code: WATERMELON. Reply with exactly: ACKNOWLEDGED",
      );
      expect(first.text.length).toBeGreaterThan(0);
      const sessionId = first.sessionId;

      // Close client A (simulates uwf-hermes process exit)
      await clientA.close();

      // --- Client B: resume (simulates re-entry) ---
      const clientB = new HermesAcpClient();
      clients.push(clientB);

      await clientB.resume(sessionId, process.cwd());
      const second = await clientB.prompt(
        "What was the secret code I told you earlier? Reply with just the code word.",
      );

      // The critical assertion: resumed session produces non-empty output
      expect(second.text.length).toBeGreaterThan(0);
      expect(second.sessionId).toBe(sessionId);
    },
    { timeout: 3 * 60 * 1000 },
  );
});
