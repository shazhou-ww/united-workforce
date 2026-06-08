import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  clearThreadFailedAttempts,
  completeThread,
  createUwfStore,
  setThread,
  type UwfStore,
} from "../store.js";

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-clear-failed-"));
  originalEnv = process.env.OCAS_HOME;
  process.env.OCAS_HOME = join(tmpDir, "cas");
  await mkdir(process.env.OCAS_HOME, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = originalEnv;
  }
});

function failedVarName(threadId: ThreadId, role: string): string {
  return `@uwf/thread-failed/${threadId}/${role}`;
}

async function seedFailedAttempt(uwf: UwfStore, threadId: ThreadId, role: string): Promise<void> {
  const listHash = (await uwf.store.cas.put(
    uwf.schemas.text,
    JSON.stringify(["STEP00000000A"]),
  )) as CasRef;
  uwf.varStore.set(failedVarName(threadId, role), listHash);
}

async function seedHead(uwf: UwfStore, label: string): Promise<CasRef> {
  return (await uwf.store.cas.put(uwf.schemas.text, label)) as CasRef;
}

function countFailedVars(uwf: UwfStore, threadId: ThreadId): number {
  return uwf.varStore.list({ namePrefix: `@uwf/thread-failed/${threadId}/` }).length;
}

describe("clearThreadFailedAttempts", () => {
  test("removes all failed-attempts vars for the given thread only", async () => {
    const uwf = await createUwfStore(tmpDir);
    const threadId = "01JTESTCLEAR0000000000001A" as ThreadId;
    const otherThread = "01JTESTCLEAR0000000000002B" as ThreadId;

    await seedFailedAttempt(uwf, threadId, "planner");
    await seedFailedAttempt(uwf, threadId, "reviewer");
    await seedFailedAttempt(uwf, otherThread, "planner");

    expect(countFailedVars(uwf, threadId)).toBe(2);
    expect(countFailedVars(uwf, otherThread)).toBe(1);

    clearThreadFailedAttempts(uwf.varStore, threadId);

    expect(countFailedVars(uwf, threadId)).toBe(0);
    // The other thread's lineage is untouched.
    expect(countFailedVars(uwf, otherThread)).toBe(1);
  });

  test("is a no-op when no failed-attempts vars exist", async () => {
    const uwf = await createUwfStore(tmpDir);
    const threadId = "01JTESTCLEAR0000000000003C" as ThreadId;
    expect(() => clearThreadFailedAttempts(uwf.varStore, threadId)).not.toThrow();
    expect(countFailedVars(uwf, threadId)).toBe(0);
  });
});

describe("completeThread clears failed-attempts lineage", () => {
  test("completion clears the thread's failed-attempts vars", async () => {
    const uwf = await createUwfStore(tmpDir);
    const threadId = "01JTESTCLEAR0000000000004D" as ThreadId;
    const head = await seedHead(uwf, "head");

    setThread(uwf.varStore, threadId, {
      head,
      status: "idle",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });
    await seedFailedAttempt(uwf, threadId, "planner");
    expect(countFailedVars(uwf, threadId)).toBe(1);

    completeThread(uwf.varStore, threadId, "completed");

    expect(countFailedVars(uwf, threadId)).toBe(0);
  });

  test("cancellation clears the thread's failed-attempts vars", async () => {
    const uwf = await createUwfStore(tmpDir);
    const threadId = "01JTESTCLEAR0000000000005E" as ThreadId;
    const head = await seedHead(uwf, "head");

    setThread(uwf.varStore, threadId, {
      head,
      status: "running",
      suspendedRole: null,
      suspendMessage: null,
      completedAt: null,
    });
    await seedFailedAttempt(uwf, threadId, "planner");
    await seedFailedAttempt(uwf, threadId, "reviewer");
    expect(countFailedVars(uwf, threadId)).toBe(2);

    completeThread(uwf.varStore, threadId, "cancelled");

    expect(countFailedVars(uwf, threadId)).toBe(0);
  });
});
