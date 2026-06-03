import { describe, expect, test } from 'vitest';
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { addHistoryEntry, createUwfStore, loadAllHistory } from "../store.js";

async function makeUwfStore(storageRoot: string) {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_DIR = casDir;
  return createUwfStore(storageRoot);
}

async function seedHistoryHead(
  uwf: Awaited<ReturnType<typeof createUwfStore>>,
  label: string,
): Promise<CasRef> {
  return (await uwf.store.cas.put(uwf.schemas.text, label)) as CasRef;
}

describe("thread cancel status", () => {
  test("cancelled history entry has reason 'cancelled'", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL1" as ThreadId;
    const uwf = await makeUwfStore(tmpDir);
    const head = await seedHistoryHead(uwf, "cancelled-head");

    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: "test-workflow",
      head,
      completedAt: Date.now(),
      reason: "cancelled",
    });

    const history = loadAllHistory(uwf.varStore);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("cancelled");
  });

  test("completed history entry has reason 'completed'", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL2" as ThreadId;
    const uwf = await makeUwfStore(tmpDir);
    const head = await seedHistoryHead(uwf, "completed-head");

    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: "test-workflow",
      head,
      completedAt: Date.now(),
      reason: "completed",
    });

    const history = loadAllHistory(uwf.varStore);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("completed");
  });

  test("history entry with null reason is stored as completed", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL3" as ThreadId;
    const uwf = await makeUwfStore(tmpDir);
    const head = await seedHistoryHead(uwf, "legacy-head");

    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: "test-workflow",
      head,
      completedAt: Date.now(),
      reason: null,
    });

    const history = loadAllHistory(uwf.varStore);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("completed");
  });

  test("mixed completed and cancelled entries preserve distinct reasons", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const head1 = await seedHistoryHead(uwf, "head1");
    const head2 = await seedHistoryHead(uwf, "head2");

    addHistoryEntry(uwf.varStore, {
      thread: "01JTEST000000000000CANCEL4" as ThreadId,
      workflow: "test-workflow",
      head: head1,
      completedAt: Date.now(),
      reason: "completed",
    });

    addHistoryEntry(uwf.varStore, {
      thread: "01JTEST000000000000CANCEL5" as ThreadId,
      workflow: "test-workflow",
      head: head2,
      completedAt: Date.now(),
      reason: "cancelled",
    });

    const history = loadAllHistory(uwf.varStore);
    expect(history).toHaveLength(2);
    const reasons = history.map((entry) => entry.reason).sort();
    expect(reasons).toEqual(["cancelled", "completed"]);
  });
});
