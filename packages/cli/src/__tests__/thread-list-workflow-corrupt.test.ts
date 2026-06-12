import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { createThreadIndexEntry } from "@united-workforce/protocol";
import { generateUlid } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdThreadList } from "../commands/thread.js";
import type { UwfStore } from "../store.js";
import { completeThread as completeThreadInStore, setThread } from "../store.js";
import { makeUwfStore } from "./thread-test-helpers.js";

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "thread-list-workflow-corrupt-test-"));
});

afterEach(async () => {
  if (savedOcasHome === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = savedOcasHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ── issue #326: loadWorkflowPayload throws instead of process.exit ───────────

describe("loadWorkflowPayload throws on error (#326)", () => {
  test("active thread with missing workflow CAS node appears as corrupt", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const now = Date.now();

    // Create a valid thread
    const validId = await createTestThread(uwf, tmpDir, workflowHash, now);

    // Create a thread with a different workflow, then delete it
    const otherWorkflowPayload = {
      name: "other-workflow",
      roles: {
        role1: {
          goal: "other goal",
          outputSchema: { type: "object" as const, properties: {} },
        },
      },
      graph: { start: "role1" },
      conditions: {},
    };
    const otherWorkflowHash = await uwf.store.cas.put(uwf.schemas.workflow, otherWorkflowPayload);
    const corruptId = await createTestThread(uwf, tmpDir, otherWorkflowHash, now + 1000);

    // Delete the other workflow CAS node — start node still exists but workflow ref dangles
    uwf.store.cas.delete(otherWorkflowHash);

    // thread list should NOT crash — corrupt thread appears with status: "corrupt"
    const result = await cmdThreadList(tmpDir, null, null, null, null, null, true);

    expect(result.length).toBe(2);

    const validItem = result.find((r) => r.thread === validId);
    expect(validItem).toBeDefined();
    expect(validItem!.status).toBe("idle");

    const corruptItem = result.find((r) => r.thread === corruptId);
    expect(corruptItem).toBeDefined();
    expect(corruptItem!.status).toBe("corrupt");
    expect(corruptItem!.statusDisplay).toBe("corrupt");
  });

  test("active thread with wrong-type workflow CAS node appears as corrupt", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const now = Date.now();

    // Create a valid workflow and thread
    const workflowHash = await createTestWorkflow(uwf);
    const validId = await createTestThread(uwf, tmpDir, workflowHash, now);

    // Create a non-workflow CAS node (text type) and use its hash as a workflow ref
    const wrongTypeHash = await uwf.store.cas.put(uwf.schemas.text, "not a workflow");

    // Create a thread whose start node points to the wrong-type CAS node
    const corruptId = generateUlid(now + 1000) as ThreadId;
    const startPayload = {
      workflow: wrongTypeHash,
      prompt: "corrupt thread with wrong type workflow",
      cwd: tmpDir,
    };
    const headHash = await uwf.store.cas.put(uwf.schemas.startNode, startPayload);
    setThread(uwf.varStore, corruptId, createThreadIndexEntry(headHash));

    // thread list should NOT crash — wrong-type thread appears as corrupt
    const result = await cmdThreadList(tmpDir, null, null, null, null, null, true);

    expect(result.length).toBe(2);

    const validItem = result.find((r) => r.thread === validId);
    expect(validItem).toBeDefined();
    expect(validItem!.status).toBe("idle");

    const corruptItem = result.find((r) => r.thread === corruptId);
    expect(corruptItem).toBeDefined();
    expect(corruptItem!.status).toBe("corrupt");
    expect(corruptItem!.statusDisplay).toBe("corrupt");
  });

  test("completed thread with missing workflow CAS node retains stored status with --all", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const now = Date.now();

    // Create two separate workflows so we can corrupt one without affecting the other
    const activeWorkflowHash = await createTestWorkflow(uwf);
    const completedWorkflowPayload = {
      name: "completed-workflow",
      roles: {
        role1: {
          goal: "completed goal",
          outputSchema: { type: "object" as const, properties: {} },
        },
      },
      graph: { start: "role1" },
      conditions: {},
    };
    const completedWorkflowHash = await uwf.store.cas.put(
      uwf.schemas.workflow,
      completedWorkflowPayload,
    );

    // Create a valid active thread
    const activeId = await createTestThread(uwf, tmpDir, activeWorkflowHash, now);

    // Create a thread and complete it
    const completedId = await createTestThread(uwf, tmpDir, completedWorkflowHash, now + 1000);
    completeThreadInStore(uwf.varStore, completedId, "end");

    // Delete only the completed thread's workflow CAS node
    uwf.store.cas.delete(completedWorkflowHash);

    // thread list --all should NOT crash
    const result = await cmdThreadList(tmpDir, null, null, null, null, null, true);

    expect(result.length).toBe(2);

    // Active thread is still valid (its workflow exists)
    const activeItem = result.find((r) => r.thread === activeId);
    expect(activeItem).toBeDefined();
    expect(activeItem!.status).toBe("idle");

    // Completed thread retains its stored status — collectCompletedThreads only calls
    // resolveWorkflowFromHead (returns ref from start node) and never loads the workflow CAS node
    const completedItem = result.find((r) => r.thread === completedId);
    expect(completedItem).toBeDefined();
    expect(completedItem!.status).toBe("end");
    expect(completedItem!.statusDisplay).toBe("end");
    // workflowName is null because the workflow ref won't match a registry entry
    // (the deleted workflow was never registered)
    expect(completedItem!.workflowName).toBeNull();
  });
});
