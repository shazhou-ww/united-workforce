import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@uncaged/workflow-protocol";
import { extractUlidTimestamp, generateUlid } from "@uncaged/workflow-util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createMarker, deleteMarker } from "../background/index.js";
import { cmdThreadList } from "../commands/thread.js";
import { parseTimeInput } from "../commands/thread-time-parser.js";
import type { UwfStore } from "../store.js";
import { appendThreadHistory, createUwfStore, saveThreadsIndex } from "../store.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  // Set UNCAGED_CAS_DIR to use the test's CAS directory
  process.env.UNCAGED_CAS_DIR = casDir;
  return createUwfStore(storageRoot);
}

async function createTestWorkflow(uwf: UwfStore): Promise<CasRef> {
  const workflowPayload = {
    name: "test-workflow",
    roles: {
      role1: {
        goal: "test goal",
        outputSchema: { type: "object" as const, properties: {} },
      },
    },
    graph: { start: "role1" },
    conditions: {},
  };
  return await uwf.store.put(uwf.schemas.workflow, workflowPayload);
}

async function createTestThread(
  uwf: UwfStore,
  storageRoot: string,
  workflowHash: CasRef,
  timestamp: number,
): Promise<ThreadId> {
  const threadId = generateUlid(timestamp) as ThreadId;
  const startPayload = {
    workflow: workflowHash,
    prompt: "test prompt",
  };
  const headHash = await uwf.store.put(uwf.schemas.startNode, startPayload);
  const index = await import("../store.js").then((m) => m.loadThreadsIndex(storageRoot));
  index[threadId] = headHash;
  await saveThreadsIndex(storageRoot, index);
  return threadId;
}

async function markThreadRunning(storageRoot: string, threadId: ThreadId, workflow: CasRef) {
  await createMarker(storageRoot, {
    thread: threadId,
    workflow,
    pid: process.pid, // Use current process PID so isPidAlive returns true
    startedAt: Date.now(),
  });
}

async function completeThread(
  storageRoot: string,
  threadId: ThreadId,
  workflowHash: CasRef,
  headHash: CasRef,
) {
  const index = await import("../store.js").then((m) => m.loadThreadsIndex(storageRoot));
  delete index[threadId];
  await saveThreadsIndex(storageRoot, index);
  await appendThreadHistory(storageRoot, {
    thread: threadId,
    workflow: workflowHash,
    head: headHash,
    completedAt: Date.now(),
    reason: null,
  });
}

// ── test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "thread-list-filters-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── status filter tests ───────────────────────────────────────────────────────

describe("cmdThreadList status filter", () => {
  test("should return idle and running threads when status=active", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    await markThreadRunning(tmpDir, thread2, workflowHash);

    const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
    const thread3Head = index[thread3];
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, ["idle", "running"], null, null, null, null);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([thread1, thread2].sort());

    // Clean up marker after test
    await deleteMarker(tmpDir, thread2);
  });

  test("should support comma-separated status values", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    await markThreadRunning(tmpDir, thread2, workflowHash);

    const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
    const thread3Head = index[thread3];
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, ["idle", "completed"], null, null, null, null);

    // Clean up marker
    await deleteMarker(tmpDir, thread2);

    // thread2 is running (not idle), so should not be included
    // Expected: thread1 (idle) and thread3 (completed)
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([thread1, thread3].sort());
  });

  test("should support single status filter (backward compat)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const _thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const _thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
    const thread3Head = index[thread3];
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, ["completed"], null, null, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(thread3);
    expect(result[0]?.status).toBe("completed");
  });

  test("should return all threads when no status filter provided", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    await markThreadRunning(tmpDir, thread2, workflowHash);

    const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
    const thread3Head = index[thread3];
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, null, null, null, null, null);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.thread).sort()).toEqual([thread1, thread2, thread3].sort());
  });
});

// ── time range filtering tests ────────────────────────────────────────────────

describe("cmdThreadList time filters", () => {
  test("should filter threads created after given timestamp", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const ts1 = Date.UTC(2026, 4, 20, 0, 0, 0);
    const ts2 = Date.UTC(2026, 4, 21, 0, 0, 0);
    const ts3 = Date.UTC(2026, 4, 22, 0, 0, 0);

    const _threadA = await createTestThread(uwf, tmpDir, workflowHash, ts1);
    const threadB = await createTestThread(uwf, tmpDir, workflowHash, ts2);
    const threadC = await createTestThread(uwf, tmpDir, workflowHash, ts3);

    // Use a timestamp slightly before ts2 to include threadB
    const afterMs = Date.UTC(2026, 4, 20, 12, 0, 0);
    const result = await cmdThreadList(tmpDir, null, afterMs, null, null, null);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([threadB, threadC].sort());
  });

  test("should filter threads created before given timestamp", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const ts1 = Date.UTC(2026, 4, 20, 0, 0, 0);
    const ts2 = Date.UTC(2026, 4, 21, 0, 0, 0);
    const ts3 = Date.UTC(2026, 4, 22, 0, 0, 0);

    const threadA = await createTestThread(uwf, tmpDir, workflowHash, ts1);
    const threadB = await createTestThread(uwf, tmpDir, workflowHash, ts2);
    const _threadC = await createTestThread(uwf, tmpDir, workflowHash, ts3);

    const beforeMs = Date.UTC(2026, 4, 22, 0, 0, 0);
    const result = await cmdThreadList(tmpDir, null, null, beforeMs, null, null);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([threadA, threadB].sort());
  });

  test("should support both after and before filters (time range)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const ts1 = Date.UTC(2026, 4, 20, 0, 0, 0);
    const ts2 = Date.UTC(2026, 4, 21, 0, 0, 0);
    const ts3 = Date.UTC(2026, 4, 22, 0, 0, 0);

    const _threadA = await createTestThread(uwf, tmpDir, workflowHash, ts1);
    const threadB = await createTestThread(uwf, tmpDir, workflowHash, ts2);
    const _threadC = await createTestThread(uwf, tmpDir, workflowHash, ts3);

    const afterMs = Date.UTC(2026, 4, 20, 12, 0, 0);
    const beforeMs = Date.UTC(2026, 4, 22, 0, 0, 0);
    const result = await cmdThreadList(tmpDir, null, afterMs, beforeMs, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(threadB);
  });
});

// ── pagination tests ──────────────────────────────────────────────────────────

describe("cmdThreadList pagination", () => {
  test("should limit results with --take", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const threads: ThreadId[] = [];
    for (let i = 0; i < 10; i++) {
      threads.push(await createTestThread(uwf, tmpDir, workflowHash, Date.now() - i * 1000));
    }

    const result = await cmdThreadList(tmpDir, null, null, null, null, 5);

    expect(result).toHaveLength(5);
  });

  test("should skip first N threads with --skip", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const threads: ThreadId[] = [];
    // Create threads in chronological order, but they'll be sorted newest first
    for (let i = 0; i < 10; i++) {
      threads.push(await createTestThread(uwf, tmpDir, workflowHash, Date.now() + i * 100));
      // Small delay to ensure distinct timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const result = await cmdThreadList(tmpDir, null, null, null, 3, null);

    expect(result).toHaveLength(7);
    // The 3 newest threads should be skipped, so we should get the 7 oldest
  });

  test("should support skip + take for pagination", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const threads: ThreadId[] = [];
    for (let i = 0; i < 10; i++) {
      threads.push(await createTestThread(uwf, tmpDir, workflowHash, Date.now() + i * 100));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const result = await cmdThreadList(tmpDir, null, null, null, 5, 3);

    expect(result).toHaveLength(3);
    // Should skip first 5 (newest), then take 3
  });

  test("should handle take > available threads", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const _thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const _thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const _thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    const result = await cmdThreadList(tmpDir, null, null, null, null, 10);

    expect(result).toHaveLength(3);
  });

  test("should return empty array when skip >= thread count", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    const result = await cmdThreadList(tmpDir, null, null, null, 5, null);

    expect(result).toHaveLength(0);
  });
});

// ── combined filters tests ────────────────────────────────────────────────────

describe("combined filters", () => {
  test("should combine status and time range filters", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const ts1 = Date.UTC(2026, 4, 20, 0, 0, 0);
    const ts2 = Date.UTC(2026, 4, 21, 0, 0, 0);
    const ts3 = Date.UTC(2026, 4, 22, 0, 0, 0);
    const ts4 = Date.UTC(2026, 4, 23, 0, 0, 0);

    const _thread1 = await createTestThread(uwf, tmpDir, workflowHash, ts1);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, ts2);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, ts3);
    const thread4 = await createTestThread(uwf, tmpDir, workflowHash, ts4);

    await markThreadRunning(tmpDir, thread2, workflowHash);

    const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
    const thread3Head = index[thread3];
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const afterMs = Date.UTC(2026, 4, 20, 12, 0, 0);
    const result = await cmdThreadList(tmpDir, ["idle"], afterMs, null, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(thread4);
    expect(result[0]?.status).toBe("idle");

    // Clean up marker
    await deleteMarker(tmpDir, thread2);
  });

  test("should combine status filter and pagination", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const threads: ThreadId[] = [];
    for (let i = 9; i >= 0; i--) {
      const thread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() + i * 1000);
      threads.push(thread);
      const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
      const headHash = index[thread];
      if (headHash === undefined) throw new Error("head not found");
      await completeThread(tmpDir, thread, workflowHash, headHash);
    }

    const result = await cmdThreadList(tmpDir, ["completed"], null, null, 3, 5);

    expect(result).toHaveLength(5);
    for (const r of result) {
      expect(r.status).toBe("completed");
    }
  });

  test("should combine time range and pagination", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const threads: ThreadId[] = [];
    for (let i = 0; i < 20; i++) {
      const ts = Date.UTC(2026, 4, 1 + i, 0, 0, 0);
      threads.push(await createTestThread(uwf, tmpDir, workflowHash, ts));
    }

    const afterMs = Date.UTC(2026, 4, 10, 0, 0, 0);
    const result = await cmdThreadList(tmpDir, null, afterMs, null, 2, 5);

    expect(result).toHaveLength(5);
    for (const r of result) {
      const ts = extractUlidTimestamp(r.thread);
      expect(ts).not.toBeNull();
      if (ts !== null) {
        expect(ts).toBeGreaterThan(afterMs);
      }
    }
  });

  async function setupMixedStatusThreads(
    uwf: UwfStore,
    workflowHash: string,
    count: number,
  ): Promise<ThreadId[]> {
    const threads: ThreadId[] = [];
    for (let i = 0; i < count; i++) {
      const ts = Date.UTC(2026, 4, 10 + i, 0, 0, 0);
      const thread = await createTestThread(uwf, tmpDir, workflowHash, ts);
      threads.push(thread);

      if (i % 2 === 0) {
        const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
        const headHash = index[thread];
        if (headHash === undefined) throw new Error("head not found");
        await completeThread(tmpDir, thread, workflowHash, headHash);
      } else {
        await markThreadRunning(tmpDir, thread, workflowHash);
      }
    }
    return threads;
  }

  async function cleanupRunningMarkers(threads: ThreadId[]): Promise<void> {
    for (let i = 0; i < threads.length; i++) {
      if (i % 2 !== 0) {
        await deleteMarker(tmpDir, threads[i] as ThreadId);
      }
    }
  }

  test("should combine all filters (status + time + pagination)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const threads = await setupMixedStatusThreads(uwf, workflowHash, 15);

    const afterMs = Date.UTC(2026, 4, 14, 12, 0, 0);
    const beforeMs = Date.UTC(2026, 4, 20, 0, 0, 0);
    const result = await cmdThreadList(tmpDir, ["idle", "running"], afterMs, beforeMs, 1, 3);

    expect(result.length).toBeLessThanOrEqual(3);
    for (const r of result) {
      expect(["idle", "running"]).toContain(r.status);
      const ts = extractUlidTimestamp(r.thread);
      if (ts !== null) {
        expect(ts).toBeGreaterThan(afterMs);
        expect(ts).toBeLessThan(beforeMs);
      }
    }

    await cleanupRunningMarkers(threads);
  });
});

// ── edge cases tests ──────────────────────────────────────────────────────────

describe("edge cases", () => {
  test("should handle empty thread list", async () => {
    await makeUwfStore(tmpDir);
    const result = await cmdThreadList(tmpDir, null, null, null, null, null);
    expect(result).toHaveLength(0);
  });

  test("should skip threads with invalid ULID when time filtering", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    const index = await import("../store.js").then((m) => m.loadThreadsIndex(tmpDir));
    index["INVALID_ULID_FORMAT_HERE" as ThreadId] = "01J6HMVRNQKJV2";
    await saveThreadsIndex(tmpDir, index);

    const afterMs = Date.now() - 3000;
    const result = await cmdThreadList(tmpDir, null, afterMs, null, null, null);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([thread1, thread2].sort());
  });
});

// ── time parsing tests ────────────────────────────────────────────────────────

describe("relative time parsing", () => {
  test("should parse '7d' as 7 days ago", () => {
    const nowMs = Date.UTC(2026, 4, 24, 12, 0, 0);
    const result = parseTimeInput("7d", nowMs);
    const expected = Date.UTC(2026, 4, 17, 12, 0, 0);
    expect(result).toBe(expected);
  });

  test("should parse '24h' as 24 hours ago", () => {
    const nowMs = Date.UTC(2026, 4, 24, 12, 0, 0);
    const result = parseTimeInput("24h", nowMs);
    const expected = Date.UTC(2026, 4, 23, 12, 0, 0);
    expect(result).toBe(expected);
  });

  test("should parse '30m' as 30 minutes ago", () => {
    const nowMs = Date.UTC(2026, 4, 24, 12, 30, 0);
    const result = parseTimeInput("30m", nowMs);
    const expected = Date.UTC(2026, 4, 24, 12, 0, 0);
    expect(result).toBe(expected);
  });

  test("should parse '1d' as 1 day ago", () => {
    const nowMs = Date.UTC(2026, 4, 24, 0, 0, 0);
    const result = parseTimeInput("1d", nowMs);
    const expected = Date.UTC(2026, 4, 23, 0, 0, 0);
    expect(result).toBe(expected);
  });
});

describe("ISO date parsing", () => {
  test("should parse ISO date (YYYY-MM-DD)", () => {
    const nowMs = Date.now();
    const result = parseTimeInput("2026-05-20", nowMs);
    const expected = Date.UTC(2026, 4, 20, 0, 0, 0);
    expect(result).toBe(expected);
  });

  test("should parse ISO datetime (YYYY-MM-DDTHH:MM:SS)", () => {
    const nowMs = Date.now();
    const result = parseTimeInput("2026-05-20T14:30:00", nowMs);
    const expected = Date.parse("2026-05-20T14:30:00");
    expect(result).toBe(expected);
  });

  test("should parse ISO datetime with Z suffix", () => {
    const nowMs = Date.now();
    const result = parseTimeInput("2026-05-20T14:30:00Z", nowMs);
    const expected = Date.UTC(2026, 4, 20, 14, 30, 0);
    expect(result).toBe(expected);
  });

  test("should reject invalid date formats", () => {
    const nowMs = Date.now();
    expect(() => parseTimeInput("not-a-date", nowMs)).toThrow();
    expect(() => parseTimeInput("2026-13-01", nowMs)).toThrow();
    expect(() => parseTimeInput("invalid", nowMs)).toThrow();
  });
});
