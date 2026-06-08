import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";
import {
  completeThread,
  createUwfStore,
  getThread,
  loadHistoryThreads,
  setThread,
} from "../store.js";

async function makeUwfStore(storageRoot: string) {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_HOME = casDir;
  return createUwfStore(storageRoot);
}

async function seedHistoryHead(
  uwf: Awaited<ReturnType<typeof createUwfStore>>,
  label: string,
): Promise<CasRef> {
  return (await uwf.store.cas.put(uwf.schemas.text, label)) as CasRef;
}

describe("thread cancel status", () => {
  test("cancelled thread has status 'cancelled'", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL1" as ThreadId;
    const uwf = await makeUwfStore(tmpDir);
    const head = await seedHistoryHead(uwf, "cancelled-head");

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
  });

  test("completed thread has status 'completed'", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const threadId = "01JTEST000000000000CANCEL2" as ThreadId;
    const uwf = await makeUwfStore(tmpDir);
    const head = await seedHistoryHead(uwf, "completed-head");

    setThread(uwf.varStore, threadId, {
      head,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });

    completeThread(uwf.varStore, threadId, "end");

    const entry = getThread(uwf.varStore, threadId);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("end");
  });

  test("loadHistoryThreads returns completed and cancelled", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const head1 = await seedHistoryHead(uwf, "head1");
    const head2 = await seedHistoryHead(uwf, "head2");

    const threadId1 = "01JTEST000000000000CANCEL4" as ThreadId;
    setThread(uwf.varStore, threadId1, {
      head: head1,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });
    completeThread(uwf.varStore, threadId1, "end");

    const threadId2 = "01JTEST000000000000CANCEL5" as ThreadId;
    setThread(uwf.varStore, threadId2, {
      head: head2,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });
    completeThread(uwf.varStore, threadId2, "cancelled");

    const history = loadHistoryThreads(uwf.varStore);
    expect(Object.keys(history)).toHaveLength(2);
    const statuses = Object.values(history)
      .map((entry) => entry.status)
      .sort();
    expect(statuses).toEqual(["cancelled", "end"]);
  });

  test("mixed completed and cancelled entries preserve distinct statuses", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "uwf-cancel-test-"));
    const uwf = await makeUwfStore(tmpDir);
    const head1 = await seedHistoryHead(uwf, "head1");
    const head2 = await seedHistoryHead(uwf, "head2");

    const threadId1 = "01JTEST000000000000CANCEL6" as ThreadId;
    setThread(uwf.varStore, threadId1, {
      head: head1,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });
    completeThread(uwf.varStore, threadId1, "end");

    const threadId2 = "01JTEST000000000000CANCEL7" as ThreadId;
    setThread(uwf.varStore, threadId2, {
      head: head2,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });
    completeThread(uwf.varStore, threadId2, "cancelled");

    const history = loadHistoryThreads(uwf.varStore);
    expect(Object.keys(history)).toHaveLength(2);
    const statuses = Object.values(history)
      .map((entry) => entry.status)
      .sort();
    expect(statuses).toEqual(["cancelled", "end"]);
  });
});
