import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  getAskSessionId,
  getCachedSessionId,
  getCachePath,
  setAskSessionId,
  setCachedSessionId,
} from "../src/session-cache.js";
import { getDefaultStorageRoot } from "../src/storage.js";

describe("session-cache ask sessions", () => {
  let testStorageRoot: string;

  beforeEach(async () => {
    testStorageRoot = join(
      getDefaultStorageRoot(),
      "test-cache",
      `ask-${Date.now()}-${Math.random()}`,
    );
    await mkdir(testStorageRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testStorageRoot, { recursive: true, force: true });
  });

  const stepHash = "ABCDEFG1234567";

  test("getAskSessionId returns null when no ask session cached", async () => {
    const session = await getAskSessionId("claude-code", stepHash, testStorageRoot);
    expect(session).toBeNull();
  });

  test("setAskSessionId + getAskSessionId round-trip", async () => {
    await setAskSessionId("claude-code", stepHash, "ask-session-123", testStorageRoot);
    const session = await getAskSessionId("claude-code", stepHash, testStorageRoot);
    expect(session).toBe("ask-session-123");
  });

  test("ask cache keys use stepHash:ask format", async () => {
    await setAskSessionId("claude-code", stepHash, "ask-session-456", testStorageRoot);

    const cachePath = getCachePath("claude-code", testStorageRoot);
    const content = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, string>;

    expect(content).toHaveProperty(`${stepHash}:ask`, "ask-session-456");
  });

  test("exec cache and ask cache coexist in same file", async () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    await setCachedSessionId("claude-code", threadId, role, "exec-session", testStorageRoot);
    await setAskSessionId("claude-code", stepHash, "ask-session", testStorageRoot);

    const cachePath = getCachePath("claude-code", testStorageRoot);
    const content = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, string>;

    expect(content).toHaveProperty(`${threadId}:${role}`, "exec-session");
    expect(content).toHaveProperty(`${stepHash}:ask`, "ask-session");

    expect(await getCachedSessionId("claude-code", threadId, role, testStorageRoot)).toBe(
      "exec-session",
    );
    expect(await getAskSessionId("claude-code", stepHash, testStorageRoot)).toBe("ask-session");
  });

  test("updating ask session does not affect exec session", async () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    await setCachedSessionId("claude-code", threadId, role, "exec-original", testStorageRoot);
    await setAskSessionId("claude-code", stepHash, "ask-original", testStorageRoot);

    await setAskSessionId("claude-code", stepHash, "ask-updated", testStorageRoot);

    expect(await getCachedSessionId("claude-code", threadId, role, testStorageRoot)).toBe(
      "exec-original",
    );
    expect(await getAskSessionId("claude-code", stepHash, testStorageRoot)).toBe("ask-updated");
  });

  test("updating exec session does not affect ask session", async () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    await setAskSessionId("claude-code", stepHash, "ask-original", testStorageRoot);
    await setCachedSessionId("claude-code", threadId, role, "exec-original", testStorageRoot);

    await setCachedSessionId("claude-code", threadId, role, "exec-updated", testStorageRoot);

    expect(await getAskSessionId("claude-code", stepHash, testStorageRoot)).toBe("ask-original");
    expect(await getCachedSessionId("claude-code", threadId, role, testStorageRoot)).toBe(
      "exec-updated",
    );
  });

  test("different stepHashes have independent ask sessions", async () => {
    const stepHashA = "AAAAAAA1234567";
    const stepHashB = "BBBBBBB1234567";

    await setAskSessionId("claude-code", stepHashA, "session-A", testStorageRoot);
    await setAskSessionId("claude-code", stepHashB, "session-B", testStorageRoot);

    expect(await getAskSessionId("claude-code", stepHashA, testStorageRoot)).toBe("session-A");
    expect(await getAskSessionId("claude-code", stepHashB, testStorageRoot)).toBe("session-B");
  });

  test("ask session for one agent does not leak to another", async () => {
    await setAskSessionId("claude-code", stepHash, "cc-ask-session", testStorageRoot);

    const ccSession = await getAskSessionId("claude-code", stepHash, testStorageRoot);
    const hermesSession = await getAskSessionId("hermes", stepHash, testStorageRoot);

    expect(ccSession).toBe("cc-ask-session");
    expect(hermesSession).toBeNull();
  });

  test("empty string ask session treated as missing", async () => {
    const cachePath = getCachePath("claude-code", testStorageRoot);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ [`${stepHash}:ask`]: "" }), "utf8");

    const session = await getAskSessionId("claude-code", stepHash, testStorageRoot);
    expect(session).toBeNull();
  });
});
