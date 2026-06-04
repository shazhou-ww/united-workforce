import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";
import {
  completeThread,
  createUwfStore,
  getThread,
  loadActiveThreads,
  loadHistoryThreads,
  setThread,
} from "../store.js";

async function makeUwfStore(storageRoot: string) {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_DIR = casDir;
  return createUwfStore(storageRoot);
}

async function seedThreadHead(
  uwf: Awaited<ReturnType<typeof createUwfStore>>,
  label: string,
): Promise<CasRef> {
  return (await uwf.store.cas.put(uwf.schemas.text, label)) as CasRef;
}

describe("unified thread storage", () => {
  test("loadActiveThreads excludes completed threads", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-active-test-"));
    const uwf = await makeUwfStore(tmpDir);

    const threadId1 = "01JTEST000000000000ACTIVE1" as ThreadId;
    const threadId2 = "01JTEST000000000000ACTIVE2" as ThreadId;
    const head1 = await seedThreadHead(uwf, "active-head");
    const head2 = await seedThreadHead(uwf, "completed-head");

    setThread(uwf.varStore, threadId1, {
      head: head1,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });

    setThread(uwf.varStore, threadId2, {
      head: head2,
      status: "completed",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: Date.now(),
    });

    const active = loadActiveThreads(uwf.varStore);
    expect(Object.keys(active)).toHaveLength(1);
    expect(active[threadId1]).toBeDefined();
    expect(active[threadId2]).toBeUndefined();
  });

  test("loadActiveThreads excludes cancelled threads", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-active-test-"));
    const uwf = await makeUwfStore(tmpDir);

    const threadId1 = "01JTEST000000000000ACTIVE3" as ThreadId;
    const threadId2 = "01JTEST000000000000ACTIVE4" as ThreadId;
    const head1 = await seedThreadHead(uwf, "active-head");
    const head2 = await seedThreadHead(uwf, "cancelled-head");

    setThread(uwf.varStore, threadId1, {
      head: head1,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });

    setThread(uwf.varStore, threadId2, {
      head: head2,
      status: "cancelled",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: Date.now(),
    });

    const active = loadActiveThreads(uwf.varStore);
    expect(Object.keys(active)).toHaveLength(1);
    expect(active[threadId1]).toBeDefined();
    expect(active[threadId2]).toBeUndefined();
  });

  test("loadHistoryThreads only returns completed and cancelled", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-history-test-"));
    const uwf = await makeUwfStore(tmpDir);

    const threadId1 = "01JTEST000000000000HISTOR1" as ThreadId;
    const threadId2 = "01JTEST000000000000HISTOR2" as ThreadId;
    const threadId3 = "01JTEST000000000000HISTOR3" as ThreadId;
    const head1 = await seedThreadHead(uwf, "active-head");
    const head2 = await seedThreadHead(uwf, "completed-head");
    const head3 = await seedThreadHead(uwf, "cancelled-head");

    setThread(uwf.varStore, threadId1, {
      head: head1,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });

    setThread(uwf.varStore, threadId2, {
      head: head2,
      status: "completed",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: Date.now(),
    });

    setThread(uwf.varStore, threadId3, {
      head: head3,
      status: "cancelled",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: Date.now(),
    });

    const history = loadHistoryThreads(uwf.varStore);
    expect(Object.keys(history)).toHaveLength(2);
    expect(history[threadId1]).toBeUndefined();
    expect(history[threadId2]).toBeDefined();
    expect(history[threadId3]).toBeDefined();
  });

  test("completeThread marks thread as completed", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-complete-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const threadId = "01JTEST000000000000COMPLE1" as ThreadId;
    const head = await seedThreadHead(uwf, "active-head");

    setThread(uwf.varStore, threadId, {
      head,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });

    completeThread(uwf.varStore, threadId, "completed");

    const entry = getThread(uwf.varStore, threadId);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("completed");
    expect(entry?.completedAt).toBeDefined();
    expect(entry?.completedAt).toBeGreaterThan(0);
  });

  test("completeThread marks thread as cancelled", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-complete-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const threadId = "01JTEST000000000000COMPLE2" as ThreadId;
    const head = await seedThreadHead(uwf, "active-head");

    setThread(uwf.varStore, threadId, {
      head,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });

    completeThread(uwf.varStore, threadId, "cancelled");

    const entry = getThread(uwf.varStore, threadId);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("cancelled");
    expect(entry?.completedAt).toBeDefined();
    expect(entry?.completedAt).toBeGreaterThan(0);
  });

  test("completeThread clears suspend metadata", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-complete-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const threadId = "01JTEST000000000000COMPLE3" as ThreadId;
    const head = await seedThreadHead(uwf, "suspended-head");

    setThread(uwf.varStore, threadId, {
      head,
      status: "suspended",
      suspendedRole: "test-role",
      suspendMessage: "test message",
      completedAt: null,
    });

    completeThread(uwf.varStore, threadId, "completed");

    const entry = getThread(uwf.varStore, threadId);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("completed");
    expect(entry?.suspendedRole).toBeNull();
    expect(entry?.suspendMessage).toBeNull();
  });

  test("completeThread handles non-existent thread gracefully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-complete-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const threadId = "01JTEST000000000000NOEXIST" as ThreadId;

    // Should not throw
    completeThread(uwf.varStore, threadId, "completed");

    const entry = getThread(uwf.varStore, threadId);
    expect(entry).toBeNull();
  });

  test("status and completedAt tags are persisted and loaded", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-tags-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const threadId = "01JTEST000000000000TAGTEST" as ThreadId;
    const head = await seedThreadHead(uwf, "test-head");
    const now = Date.now();

    setThread(uwf.varStore, threadId, {
      head,
      status: "completed",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: now,
    });

    const entry = getThread(uwf.varStore, threadId);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("completed");
    expect(entry?.completedAt).toBe(now);
  });
});
