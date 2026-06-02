import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThreadId } from "@uncaged/workflow-protocol";

import { getCachedSessionId, getCachePath, setCachedSessionId } from "../src/session-cache.js";
import { resolveStorageRoot } from "../src/storage.js";

describe("session-cache", () => {
  let originalStorageRoot: string;
  let testStorageRoot: string;

  beforeEach(async () => {
    // Create a temporary test storage root
    originalStorageRoot = resolveStorageRoot();
    testStorageRoot = join(originalStorageRoot, "test-cache", `test-${Date.now()}`);
    await mkdir(testStorageRoot, { recursive: true });

    // Override the storage root for testing
    process.env.WORKFLOW_STORAGE_ROOT = testStorageRoot;
  });

  afterEach(async () => {
    // Clean up test storage root
    await rm(testStorageRoot, { recursive: true, force: true });
    delete process.env.WORKFLOW_STORAGE_ROOT;
  });

  describe("getCachePath", () => {
    test("returns agent-specific file path", () => {
      const path = getCachePath("claude-code");
      expect(path).toMatch(/\/cache\/claude-code-sessions\.json$/);
    });

    test("returns different paths for different agents", () => {
      const pathClaudeCode = getCachePath("claude-code");
      const pathHermes = getCachePath("hermes");

      expect(pathClaudeCode).not.toBe(pathHermes);
      expect(pathClaudeCode).toMatch(/claude-code-sessions\.json$/);
      expect(pathHermes).toMatch(/hermes-sessions\.json$/);
    });

    test("handles agent names with special characters", () => {
      const path1 = getCachePath("my-agent");
      const path2 = getCachePath("my_agent");

      expect(path1).toMatch(/my-agent-sessions\.json$/);
      expect(path2).toMatch(/my_agent-sessions\.json$/);
    });
  });

  describe("session isolation", () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    test("sessions are isolated per agent", async () => {
      // Cache different session IDs for each agent
      await setCachedSessionId("claude-code", threadId, role, "session-cc-001");
      await setCachedSessionId("hermes", threadId, role, "session-hermes-001");

      // Each agent should retrieve its own session ID
      const sessionCC = await getCachedSessionId("claude-code", threadId, role);
      const sessionHermes = await getCachedSessionId("hermes", threadId, role);

      expect(sessionCC).toBe("session-cc-001");
      expect(sessionHermes).toBe("session-hermes-001");
    });

    test("updating one agent's cache does not affect another", async () => {
      // Set initial sessions for both agents
      await setCachedSessionId("claude-code", threadId, role, "session-cc-001");
      await setCachedSessionId("hermes", threadId, role, "session-hermes-001");

      // Update claude-code's session
      await setCachedSessionId("claude-code", threadId, role, "session-cc-002");

      // Hermes's session should remain unchanged
      const sessionHermes = await getCachedSessionId("hermes", threadId, role);
      expect(sessionHermes).toBe("session-hermes-001");

      // Claude-code should have the new session
      const sessionCC = await getCachedSessionId("claude-code", threadId, role);
      expect(sessionCC).toBe("session-cc-002");
    });

    test("missing session returns null for specific agent", async () => {
      const session = await getCachedSessionId("claude-code", threadId, role);
      expect(session).toBeNull();
    });

    test("empty session ID is treated as missing", async () => {
      await setCachedSessionId("claude-code", threadId, role, "");

      const session = await getCachedSessionId("claude-code", threadId, role);
      expect(session).toBeNull();
    });
  });

  describe("file system operations", () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    test("cache directory is created if missing", async () => {
      const cachePath = getCachePath("claude-code");
      const cacheDir = dirname(cachePath);

      // Ensure cache dir doesn't exist
      await rm(cacheDir, { recursive: true, force: true });

      // Write a session
      await setCachedSessionId("claude-code", threadId, role, "session-001");

      // Cache directory should be created
      const stats = await stat(cacheDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test("multiple agents create separate cache files", async () => {
      // Cache sessions for multiple agents
      await setCachedSessionId("claude-code", threadId, role, "session-cc-001");
      await setCachedSessionId("hermes", threadId, role, "session-hermes-001");

      // Separate cache files should exist
      const pathCC = getCachePath("claude-code");
      const pathHermes = getCachePath("hermes");

      const contentCC = JSON.parse(await readFile(pathCC, "utf8")) as Record<string, string>;
      const contentHermes = JSON.parse(await readFile(pathHermes, "utf8")) as Record<
        string,
        string
      >;

      expect(contentCC).toHaveProperty(`${threadId}:${role}`, "session-cc-001");
      expect(contentHermes).toHaveProperty(`${threadId}:${role}`, "session-hermes-001");
    });

    test("atomic writes prevent partial reads", async () => {
      // Write a session
      await setCachedSessionId("claude-code", threadId, role, "session-001");

      // The final file should exist (no .tmp files left behind)
      const cachePath = getCachePath("claude-code");
      const dir = dirname(cachePath);
      const files = await readdir(dir);

      expect(files).toContain("claude-code-sessions.json");
      expect(files.every((f) => !f.endsWith(".tmp"))).toBe(true);
    });
  });

  describe("legacy migration", () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    test("old agent-sessions.json is ignored", async () => {
      // Create old agent-sessions.json file
      const oldCachePath = join(resolveStorageRoot(), "cache", "agent-sessions.json");
      await mkdir(dirname(oldCachePath), { recursive: true });
      await writeFile(
        oldCachePath,
        JSON.stringify({
          "01234567890123456789012345:developer": "old-session-001",
        }),
        "utf8",
      );

      // Query with the new per-agent cache
      const session = await getCachedSessionId("claude-code", threadId, role);

      // Should return null (old cache is ignored)
      expect(session).toBeNull();
    });

    test("new per-agent cache takes precedence", async () => {
      // Create both old and new cache files
      const oldPath = join(resolveStorageRoot(), "cache", "agent-sessions.json");
      await mkdir(dirname(oldPath), { recursive: true });
      await writeFile(
        oldPath,
        JSON.stringify({
          [`${threadId}:${role}`]: "old-session",
        }),
        "utf8",
      );

      await setCachedSessionId("claude-code", threadId, role, "new-session");

      // The new per-agent cache value should be returned
      const session = await getCachedSessionId("claude-code", threadId, role);
      expect(session).toBe("new-session");
    });
  });

  describe("error handling", () => {
    const threadId = "01234567890123456789012345" as ThreadId;
    const role = "developer";

    test("invalid JSON in cache file returns empty cache", async () => {
      // Create a corrupted cache file
      const cachePath = getCachePath("claude-code");
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, "{ invalid json }", "utf8");

      // Should return null (treating corrupted cache as empty)
      const session = await getCachedSessionId("claude-code", threadId, role);
      expect(session).toBeNull();
    });

    test("non-object JSON in cache file returns empty cache", async () => {
      // Create a cache file with non-object JSON
      const cachePath = getCachePath("claude-code");
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(["not", "an", "object"]), "utf8");

      // Should return null
      const session = await getCachedSessionId("claude-code", threadId, role);
      expect(session).toBeNull();
    });

    test("cache entries with non-string values are ignored", async () => {
      // Create a cache file with mixed types
      const cachePath = getCachePath("claude-code");
      const cacheData = {
        "thread1:role1": "valid-session",
        "thread2:role2": 12345, // number
        "thread3:role3": null, // null
        "thread4:role4": "", // empty string
      };
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(cacheData), "utf8");

      // Valid string entries should be returned
      const session1 = await getCachedSessionId("claude-code", "thread1" as ThreadId, "role1");
      expect(session1).toBe("valid-session");

      // Invalid entries should return null
      const session2 = await getCachedSessionId("claude-code", "thread2" as ThreadId, "role2");
      const session3 = await getCachedSessionId("claude-code", "thread3" as ThreadId, "role3");
      const session4 = await getCachedSessionId("claude-code", "thread4" as ThreadId, "role4");

      expect(session2).toBeNull();
      expect(session3).toBeNull();
      expect(session4).toBeNull(); // empty string is treated as missing
    });
  });
});
