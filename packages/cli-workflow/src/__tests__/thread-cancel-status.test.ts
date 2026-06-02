import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@uncaged/workflow-protocol";
import { appendThreadHistory, loadThreadHistory } from "../store.js";

describe("thread cancel status", () => {
  test("cancelled history entry has reason 'cancelled'", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL1" as ThreadId;

    await appendThreadHistory(tmpDir, {
      thread: threadId,
      workflow: "test-workflow",
      head: "test-head-hash" as CasRef,
      completedAt: Date.now(),
      reason: "cancelled",
    });

    const history = await loadThreadHistory(tmpDir);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("cancelled");
  });

  test("completed history entry has reason 'completed'", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL2" as ThreadId;

    await appendThreadHistory(tmpDir, {
      thread: threadId,
      workflow: "test-workflow",
      head: "test-head-hash" as CasRef,
      completedAt: Date.now(),
      reason: "completed",
    });

    const history = await loadThreadHistory(tmpDir);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("completed");
  });

  test("legacy history entry without reason parses as null", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL3" as ThreadId;

    // Simulate legacy entry without reason field
    await appendThreadHistory(tmpDir, {
      thread: threadId,
      workflow: "test-workflow",
      head: "test-head-hash" as CasRef,
      completedAt: Date.now(),
      reason: null,
    });

    const history = await loadThreadHistory(tmpDir);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBeNull();
  });

  test("mixed completed and cancelled entries preserve distinct reasons", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));

    await appendThreadHistory(tmpDir, {
      thread: "01JTEST000000000000CANCEL4" as ThreadId,
      workflow: "test-workflow",
      head: "head1" as CasRef,
      completedAt: Date.now(),
      reason: "completed",
    });

    await appendThreadHistory(tmpDir, {
      thread: "01JTEST000000000000CANCEL5" as ThreadId,
      workflow: "test-workflow",
      head: "head2" as CasRef,
      completedAt: Date.now(),
      reason: "cancelled",
    });

    const history = await loadThreadHistory(tmpDir);
    expect(history).toHaveLength(2);
    expect(history[0]?.reason).toBe("completed");
    expect(history[1]?.reason).toBe("cancelled");
  });
});
