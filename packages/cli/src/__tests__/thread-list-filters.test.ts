import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { createThreadIndexEntry } from "@united-workforce/protocol";
import { extractUlidTimestamp, generateUlid } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createMarker, deleteMarker, getProcessStartTime } from "../background/index.js";
import { cmdThreadList } from "../commands/thread.js";
import { parseTimeInput } from "../commands/thread-time-parser.js";
import type { UwfStore } from "../store.js";
import {
  completeThread as completeThreadInStore,
  createUwfStore,
  loadAllThreads,
  saveWorkflowRegistry,
  setThread,
} from "../store.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  // Set OCAS_HOME to use the test's CAS directory
  process.env.OCAS_HOME = casDir;
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
  return await uwf.store.cas.put(uwf.schemas.workflow, workflowPayload);
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
    cwd: storageRoot,
  };
  const headHash = await uwf.store.cas.put(uwf.schemas.startNode, startPayload);

  setThread(uwf.varStore, threadId, createThreadIndexEntry(headHash));

  return threadId;
}

async function markThreadRunning(storageRoot: string, threadId: ThreadId, workflow: CasRef) {
  await createMarker(storageRoot, {
    thread: threadId,
    workflow,
    pid: process.pid, // Use current process PID so isPidAlive returns true
    startedAt: Date.now(),
    processStartTime: getProcessStartTime(process.pid),
  });
}

async function completeThread(
  storageRoot: string,
  threadId: ThreadId,
  _workflowHash: CasRef,
  _headHash: CasRef,
) {
  const uwfIdx = await createUwfStore(storageRoot);
  completeThreadInStore(uwfIdx.varStore, threadId, "end");
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

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const thread3Head = index[thread3]!.head;
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

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const thread3Head = index[thread3]!.head;
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, ["idle", "end"], null, null, null, null);

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

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const thread3Head = index[thread3]!.head;
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, ["end"], null, null, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(thread3);
    expect(result[0]?.status).toBe("end");
  });

  test("should return only active threads when no filter and no --all", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    await markThreadRunning(tmpDir, thread2, workflowHash);

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const thread3Head = index[thread3]!.head;
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, null, null, null, null, null);

    // Default behavior (issue #147): only active threads (idle + running)
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([thread1, thread2].sort());

    // Clean up marker
    await deleteMarker(tmpDir, thread2);
  });

  test("should return all threads when --all (showAll=true)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const thread1 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const thread2 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const thread3 = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    await markThreadRunning(tmpDir, thread2, workflowHash);

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const thread3Head = index[thread3]!.head;
    if (thread3Head === undefined) throw new Error("thread3 head not found");
    await completeThread(tmpDir, thread3, workflowHash, thread3Head);

    const result = await cmdThreadList(tmpDir, null, null, null, null, null, true);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.thread).sort()).toEqual([thread1, thread2, thread3].sort());

    // Clean up marker
    await deleteMarker(tmpDir, thread2);
  });
});

// ── default behavior tests (issue #147) ───────────────────────────────────────

describe("cmdThreadList default behavior (issue #147)", () => {
  test("default returns only idle + running threads", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const threadA = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 4000);
    const threadB = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const threadC = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const threadD = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);

    await markThreadRunning(tmpDir, threadB, workflowHash);

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const threadCHead = index[threadC]!.head;
    if (threadCHead === undefined) throw new Error("threadC head not found");
    await completeThread(tmpDir, threadC, workflowHash, threadCHead);

    // Cancel threadD
    const threadDHead = index[threadD]!.head;
    if (threadDHead === undefined) throw new Error("threadD head not found");
    const uwfCancel = await createUwfStore(tmpDir);
    completeThreadInStore(uwfCancel.varStore, threadD, "cancelled");

    const result = await cmdThreadList(tmpDir, null, null, null, null, null);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([threadA, threadB].sort());

    await deleteMarker(tmpDir, threadB);
  });

  test("default excludes completed threads", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const idleThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 6000);
    const completedThreads: ThreadId[] = [];
    for (let i = 0; i < 5; i++) {
      const t = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - (5 - i) * 1000);
      completedThreads.push(t);
      const uwfIdx = await createUwfStore(tmpDir);
      const index = loadAllThreads(uwfIdx.varStore);
      const head = index[t]!.head;
      if (head === undefined) throw new Error("head not found");
      await completeThread(tmpDir, t, workflowHash, head);
    }

    const result = await cmdThreadList(tmpDir, null, null, null, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(idleThread);
  });

  test("default excludes cancelled threads", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const runningThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 4000);
    await markThreadRunning(tmpDir, runningThread, workflowHash);

    const cancelled: ThreadId[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - (3 - i) * 1000);
      cancelled.push(t);
      const uwfIdx = await createUwfStore(tmpDir);
      completeThreadInStore(uwfIdx.varStore, t, "cancelled");
    }

    const result = await cmdThreadList(tmpDir, null, null, null, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(runningThread);

    await deleteMarker(tmpDir, runningThread);
  });

  test("--all (showAll=true) returns every status", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const idleThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 4000);
    const runningThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    await markThreadRunning(tmpDir, runningThread, workflowHash);

    const completedThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    const uwfIdx = await createUwfStore(tmpDir);
    const idx = loadAllThreads(uwfIdx.varStore);
    const ch = idx[completedThread]!.head;
    if (ch === undefined) throw new Error("completedThread head not found");
    await completeThread(tmpDir, completedThread, workflowHash, ch);

    const cancelledThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);
    completeThreadInStore(uwfIdx.varStore, cancelledThread, "cancelled");

    const result = await cmdThreadList(tmpDir, null, null, null, null, null, true);

    expect(result).toHaveLength(4);
    expect(result.map((r) => r.thread).sort()).toEqual(
      [idleThread, runningThread, completedThread, cancelledThread].sort(),
    );

    await deleteMarker(tmpDir, runningThread);
  });

  test("explicit --status overrides default (still returns just the filtered statuses)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const _idleThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const runningThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    await markThreadRunning(tmpDir, runningThread, workflowHash);

    const completedThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);
    const uwfIdx = await createUwfStore(tmpDir);
    const idx = loadAllThreads(uwfIdx.varStore);
    const ch = idx[completedThread]!.head;
    if (ch === undefined) throw new Error("completedThread head not found");
    await completeThread(tmpDir, completedThread, workflowHash, ch);

    const result = await cmdThreadList(tmpDir, ["end"], null, null, null, null);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(completedThread);
    expect(result[0]?.status).toBe("end");

    await deleteMarker(tmpDir, runningThread);
  });

  test("--status active keeps working", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const idleThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const runningThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    await markThreadRunning(tmpDir, runningThread, workflowHash);

    const completedThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);
    const uwfIdx = await createUwfStore(tmpDir);
    const idx = loadAllThreads(uwfIdx.varStore);
    const ch = idx[completedThread]!.head;
    if (ch === undefined) throw new Error("completedThread head not found");
    await completeThread(tmpDir, completedThread, workflowHash, ch);

    const result = await cmdThreadList(tmpDir, ["idle", "running"], null, null, null, null);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.thread).sort()).toEqual([idleThread, runningThread].sort());

    await deleteMarker(tmpDir, runningThread);
  });

  test("--status + --all — explicit status wins", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const _idleThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 3000);
    const runningThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 2000);
    await markThreadRunning(tmpDir, runningThread, workflowHash);

    const completedThread = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - 1000);
    const uwfIdx = await createUwfStore(tmpDir);
    const idx = loadAllThreads(uwfIdx.varStore);
    const ch = idx[completedThread]!.head;
    if (ch === undefined) throw new Error("completedThread head not found");
    await completeThread(tmpDir, completedThread, workflowHash, ch);

    const result = await cmdThreadList(tmpDir, ["end"], null, null, null, null, true);

    expect(result).toHaveLength(1);
    expect(result[0]?.thread).toBe(completedThread);

    await deleteMarker(tmpDir, runningThread);
  });

  test("default returns empty when no threads", async () => {
    await makeUwfStore(tmpDir);

    const result = await cmdThreadList(tmpDir, null, null, null, null, null);

    expect(result).toHaveLength(0);
  });

  test("default + time range filter composes correctly", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    const ts1 = Date.UTC(2026, 4, 20, 0, 0, 0);
    const ts2 = Date.UTC(2026, 4, 21, 0, 0, 0);
    const ts3 = Date.UTC(2026, 4, 22, 0, 0, 0);
    const ts4 = Date.UTC(2026, 4, 23, 0, 0, 0);
    const ts5 = Date.UTC(2026, 4, 24, 0, 0, 0);

    const _t1 = await createTestThread(uwf, tmpDir, workflowHash, ts1);
    const t2 = await createTestThread(uwf, tmpDir, workflowHash, ts2);
    const t3 = await createTestThread(uwf, tmpDir, workflowHash, ts3);
    const t4 = await createTestThread(uwf, tmpDir, workflowHash, ts4);
    const _t5 = await createTestThread(uwf, tmpDir, workflowHash, ts5);

    // Mark t3 running
    await markThreadRunning(tmpDir, t3, workflowHash);

    // Complete t4 (should be excluded by default)
    const uwfIdx = await createUwfStore(tmpDir);
    const idx = loadAllThreads(uwfIdx.varStore);
    const t4head = idx[t4]!.head;
    if (t4head === undefined) throw new Error("t4 head not found");
    await completeThread(tmpDir, t4, workflowHash, t4head);

    // afterMs in middle of range to exclude _t1
    const afterMs = Date.UTC(2026, 4, 20, 12, 0, 0);
    const result = await cmdThreadList(tmpDir, null, afterMs, null, null, null);

    // Expected: t2 (idle), t3 (running), _t5 (idle); excludes t4 (completed) and _t1 (filtered by time)
    expect(result).toHaveLength(3);
    const ids = result.map((r) => r.thread).sort();
    expect(ids).toEqual([t2, t3, _t5].sort());

    await deleteMarker(tmpDir, t3);
  });

  test("default + pagination composes correctly", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    // Create 10 idle threads + 5 completed threads
    const idleThreads: ThreadId[] = [];
    for (let i = 0; i < 10; i++) {
      idleThreads.push(
        await createTestThread(uwf, tmpDir, workflowHash, Date.now() - (15 - i) * 1000),
      );
    }
    for (let i = 0; i < 5; i++) {
      const t = await createTestThread(uwf, tmpDir, workflowHash, Date.now() - (5 - i) * 1000);
      const uwfIdx = await createUwfStore(tmpDir);
      const idx = loadAllThreads(uwfIdx.varStore);
      const head = idx[t]!.head;
      if (head === undefined) throw new Error("head not found");
      await completeThread(tmpDir, t, workflowHash, head);
    }

    const result = await cmdThreadList(tmpDir, null, null, null, 2, 3);

    expect(result).toHaveLength(3);
    // All results should be idle (default excludes completed)
    for (const r of result) {
      expect(r.status).toBe("idle");
    }
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

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const thread3Head = index[thread3]!.head;
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
      const uwfIdx = await createUwfStore(tmpDir);
      const index = loadAllThreads(uwfIdx.varStore);
      const headHash = index[thread]!.head;
      if (headHash === undefined) throw new Error("head not found");
      await completeThread(tmpDir, thread, workflowHash, headHash);
    }

    const result = await cmdThreadList(tmpDir, ["end"], null, null, 3, 5);

    expect(result).toHaveLength(5);
    for (const r of result) {
      expect(r.status).toBe("end");
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
        const uwfIdx = await createUwfStore(tmpDir);
        const index = loadAllThreads(uwfIdx.varStore);
        const headHash = index[thread]!.head;
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

    const uwfIdx = await createUwfStore(tmpDir);
    const index = loadAllThreads(uwfIdx.varStore);
    const placeholderHead = (await uwfIdx.store.cas.put(
      uwfIdx.schemas.text,
      "invalid-ulid-placeholder",
    )) as CasRef;
    index["INVALID_ULID_FORMAT_HERE" as ThreadId] = {
      head: placeholderHead,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    };
    for (const [tid, ent] of Object.entries(index)) {
      setThread(uwfIdx.varStore, tid as ThreadId, ent);
    }

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

// ── corrupt thread resilience (#250) ──────────────────────────────────────────

describe("corrupt thread resilience (#250)", () => {
  test("thread list returns corrupt entry when CAS node is missing", async () => {
    const uwf = await makeUwfStore(tmpDir);

    // Create a valid thread
    const workflowHash = await createTestWorkflow(uwf);
    const now = Date.now();
    const _validId = await createTestThread(uwf, tmpDir, workflowHash, now);

    // Create another thread with a unique start node, then delete its workflow CAS to corrupt it
    const corruptThreadId = generateUlid(now + 1000) as ThreadId;
    const startPayload = {
      workflow: workflowHash,
      prompt: "corrupt thread prompt — unique to avoid CAS hash collision",
      cwd: tmpDir,
    };
    const headHash = await uwf.store.cas.put(uwf.schemas.startNode, startPayload);
    setThread(uwf.varStore, corruptThreadId, createThreadIndexEntry(headHash));

    // Delete the workflow CAS node — start node still exists but workflow ref dangles
    uwf.store.cas.delete(workflowHash);

    // thread list should NOT throw — it should return both threads
    const result = await cmdThreadList(tmpDir, null, null, null, null, null, true);

    // Both threads should appear (the valid one is now also corrupt since workflow is shared)
    // In practice: both become corrupt because they share the same workflow CAS node
    // This matches the real scenario from issue #250 — gc deleted a shared node
    expect(result.length).toBeGreaterThanOrEqual(2);
    const corruptItems = result.filter((r) => r.status === "corrupt");
    expect(corruptItems.length).toBeGreaterThanOrEqual(1);
    for (const item of corruptItems) {
      expect(item.statusDisplay).toBe("corrupt");
    }
  });

  test("corrupt threads appear in default filter (without --all)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    // Create a thread then corrupt it
    const corruptId = await createTestThread(uwf, tmpDir, workflowHash, Date.now());
    const corruptEntry = loadAllThreads(uwf.varStore)[corruptId];
    uwf.store.cas.delete(corruptEntry.head);

    // Default filter (no --all, no --status) should include corrupt
    const result = await cmdThreadList(tmpDir, null, null, null, null, null, false);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("corrupt");
  });
});

// ── orphan thread detection (#286) ────────────────────────────────────────────

describe("orphan thread detection (#286)", () => {
  test("thread list includes workflowName when workflow is in registry", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    // Register the workflow in registry
    saveWorkflowRegistry(uwf.varStore, "test-workflow", workflowHash);

    const threadId = await createTestThread(uwf, tmpDir, workflowHash, Date.now());

    const result = await cmdThreadList(tmpDir, null, null, null, null, null, false);
    expect(result).toHaveLength(1);
    expect(result[0].thread).toBe(threadId);
    expect(result[0].workflowName).toBe("test-workflow");
  });

  test("thread list returns workflowName: null for orphaned threads", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    // Do NOT register the workflow — thread is orphaned
    const threadId = await createTestThread(uwf, tmpDir, workflowHash, Date.now());

    const result = await cmdThreadList(tmpDir, null, null, null, null, null, false);
    expect(result).toHaveLength(1);
    expect(result[0].thread).toBe(threadId);
    expect(result[0].workflowName).toBeNull();
  });

  test("mixed registered and orphaned threads in the same list", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    // Register the workflow
    saveWorkflowRegistry(uwf.varStore, "test-workflow", workflowHash);

    // Create a thread using the registered workflow
    const now = Date.now();
    const registeredId = await createTestThread(uwf, tmpDir, workflowHash, now);

    // Create a second workflow (different hash), not registered
    const orphanWorkflowPayload = {
      name: "orphan-workflow",
      roles: {
        role1: {
          goal: "orphan goal",
          outputSchema: { type: "object" as const, properties: {} },
        },
      },
      graph: { start: "role1" },
      conditions: {},
    };
    const orphanHash = await uwf.store.cas.put(uwf.schemas.workflow, orphanWorkflowPayload);
    const orphanId = await createTestThread(uwf, tmpDir, orphanHash, now + 1000);

    const result = await cmdThreadList(tmpDir, null, null, null, null, null, false);
    expect(result).toHaveLength(2);

    // Sorted newest first, so orphan (later timestamp) comes first
    const orphanItem = result.find((r) => r.thread === orphanId);
    const registeredItem = result.find((r) => r.thread === registeredId);

    expect(orphanItem).toBeDefined();
    expect(orphanItem!.workflowName).toBeNull();

    expect(registeredItem).toBeDefined();
    expect(registeredItem!.workflowName).toBe("test-workflow");
  });

  test("corrupt threads have workflowName: null", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    saveWorkflowRegistry(uwf.varStore, "test-workflow", workflowHash);

    // Create a thread then corrupt it by deleting its head CAS node
    const corruptId = await createTestThread(uwf, tmpDir, workflowHash, Date.now());
    const corruptEntry = loadAllThreads(uwf.varStore)[corruptId];
    uwf.store.cas.delete(corruptEntry.head);

    const result = await cmdThreadList(tmpDir, null, null, null, null, null, false);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("corrupt");
    expect(result[0].workflowName).toBeNull();
  });
});
