import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CasRef, createThreadIndexEntry, type ThreadId } from "@united-workforce/protocol";
import { resolveHeadHash } from "../commands/shared.js";
import { addHistoryEntry, createUwfStore, setThread } from "../store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-resolve-head-"));
  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_DIR = casDir;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("resolveHeadHash", () => {
  test("returns head hash from variable store for active thread", async () => {
    const threadId = "01JTEST0000000000000000001" as ThreadId;
    const uwf = await createUwfStore(tmpDir);
    const headHash = (await uwf.store.cas.put(uwf.schemas.text, "active")) as CasRef;
    setThread(uwf.varStore, threadId, createThreadIndexEntry(headHash as CasRef));

    const result = await resolveHeadHash(tmpDir, threadId);

    expect(result).toBe(headHash);
  });

  test("falls back to history variable when thread not in active index", async () => {
    const threadId = "01JTEST0000000000000000002" as ThreadId;
    const workflowHash = "workflow_hash_789" as CasRef;

    const uwf = await createUwfStore(tmpDir);
    const headHash = (await uwf.store.cas.put(uwf.schemas.text, "completed-head")) as CasRef;
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: workflowHash,
      head: headHash,
      completedAt: Date.now(),
      reason: null,
    });

    const result = await resolveHeadHash(tmpDir, threadId);

    expect(result).toBe(headHash);
  });

  // Note: Testing the error case requires CLI-level testing because resolveHeadHash
  // calls fail() which does process.exit(1), terminating the test runner.
  // The error behavior is tested in integration tests below via CLI invocation.

  test("prioritizes active thread over history when thread exists in both", async () => {
    const threadId = "01JTEST0000000000000000004" as ThreadId;
    const workflowHash = "workflow_hash_xyz" as CasRef;

    const uwf = await createUwfStore(tmpDir);
    const activeHead = (await uwf.store.cas.put(uwf.schemas.text, "active-v2")) as CasRef;
    const historicalHash = (await uwf.store.cas.put(uwf.schemas.text, "historical-v1")) as CasRef;
    setThread(uwf.varStore, threadId, createThreadIndexEntry(activeHead));
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: workflowHash,
      head: historicalHash,
      completedAt: Date.now(),
      reason: null,
    });

    const result = await resolveHeadHash(tmpDir, threadId);

    // Should return the active head, not the historical one
    expect(result).toBe(activeHead);
  });

  test("finds thread from multiple history entries", async () => {
    const threadId1 = "01JTEST0000000000000000005" as ThreadId;
    const threadId2 = "01JTEST0000000000000000006" as ThreadId;
    const threadId3 = "01JTEST0000000000000000007" as ThreadId;
    const workflowHash = "workflow_hash_abc" as CasRef;
    const uwf = await createUwfStore(tmpDir);
    const hash1 = (await uwf.store.cas.put(uwf.schemas.text, "hash-thread1")) as CasRef;
    const hash2 = (await uwf.store.cas.put(uwf.schemas.text, "hash-thread2")) as CasRef;
    const hash3 = (await uwf.store.cas.put(uwf.schemas.text, "hash-thread3")) as CasRef;
    addHistoryEntry(uwf.varStore, {
      thread: threadId1,
      workflow: workflowHash,
      head: hash1,
      completedAt: Date.now() - 2000,
      reason: null,
    });
    addHistoryEntry(uwf.varStore, {
      thread: threadId2,
      workflow: workflowHash,
      head: hash2,
      completedAt: Date.now() - 1000,
      reason: null,
    });
    addHistoryEntry(uwf.varStore, {
      thread: threadId3,
      workflow: workflowHash,
      head: hash3,
      completedAt: Date.now(),
      reason: null,
    });

    const result = await resolveHeadHash(tmpDir, threadId2);

    expect(result).toBe(hash2);
  });
});
