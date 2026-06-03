import { describe, expect, test } from 'vitest';
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { createMarker, deleteMarker } from "../background/index.js";
import { cmdThreadList, cmdThreadShow, cmdThreadStart } from "../commands/thread.js";
import {
  addHistoryEntry,
  createUwfStore,
  deleteThread,
  loadAllThreads,
  setThread,
} from "../store.js";

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    $status: { type: "string" as const },
  },
};

const SIMPLE_WORKFLOW_YAML = `
name: test-current-role
description: Test workflow for currentRole
roles:
  roleA:
    description: First role
    goal: Do A
    capabilities: ["coding"]
    procedure: Do A
    output: |
      $status: "ready"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string, enum: ["ready", "not-ready"] }
  roleB:
    description: Second role
    goal: Do B
    capabilities: ["coding"]
    procedure: Do B
    output: |
      $status: "done"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string }
graph:
  $START:
    _:
      role: roleA
      prompt: "Do A"
      location: null
  roleA:
    ready:
      role: roleB
      prompt: "Do B"
      location: null
    not-ready:
      role: roleA
      prompt: "Try again"
      location: null
  roleB:
    _:
      role: $END
      prompt: "Done"
      location: null
`;

const CONDITIONAL_WORKFLOW_YAML = `
name: test-conditional-role
description: Conditional routing workflow
roles:
  roleA:
    description: First role
    goal: Do A
    capabilities: ["coding"]
    procedure: Do A
    output: |
      $status: "pass"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string, enum: ["pass", "fail"] }
  roleB:
    description: Pass role
    goal: Do B
    capabilities: ["coding"]
    procedure: Do B
    output: |
      $status: "done"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string }
  roleC:
    description: Fail role
    goal: Do C
    capabilities: ["coding"]
    procedure: Do C
    output: |
      $status: "done"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string }
graph:
  $START:
    _:
      role: roleA
      prompt: "Do A"
      location: null
  roleA:
    pass:
      role: roleB
      prompt: "Do B (pass)"
      location: null
    fail:
      role: roleC
      prompt: "Do C (fail)"
      location: null
  roleB:
    _:
      role: $END
      prompt: "Done"
      location: null
  roleC:
    _:
      role: $END
      prompt: "Done"
      location: null
`;

const SINGLE_ROLE_WORKFLOW_YAML = `
name: test-single-role
description: Single role that goes to END
roles:
  worker:
    description: Worker
    goal: Work
    capabilities: ["coding"]
    procedure: Work
    output: |
      $status: "done"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string }
graph:
  $START:
    _:
      role: worker
      prompt: "Work"
      location: null
  worker:
    _:
      role: $END
      prompt: "Done"
      location: null
`;

/** Helper: insert a completed step node after the current head. */
async function insertStepNode(
  storageRoot: string,
  threadId: ThreadId,
  role: string,
  outputPayload: Record<string, unknown>,
): Promise<void> {
  const uwf = await createUwfStore(storageRoot);
  const index = loadAllThreads(uwf.varStore);
  const headEntry = index[threadId];
  if (headEntry === undefined) throw new Error(`thread ${threadId} not in index`);
  const head = headEntry.head;

  const outputSchemaHash = await putSchema(uwf.store, OUTPUT_SCHEMA);
  const outputHash = await uwf.store.cas.put(outputSchemaHash, outputPayload);

  // Use text schema for detail (simple placeholder)
  const detailHash = await uwf.store.cas.put(uwf.schemas.text, "detail-placeholder");

  // Resolve start hash from head
  const headNode = uwf.store.cas.get(head);
  if (headNode === null) throw new Error(`head ${head} not found`);
  const isStart = headNode.type === uwf.schemas.startNode;
  const startHash = isStart ? head : (headNode.payload as { start: CasRef }).start;

  const stepHash = (await uwf.store.cas.put(uwf.schemas.stepNode, {
    start: startHash,
    prev: isStart ? null : head,
    role,
    output: outputHash,
    detail: detailHash,
    agent: "uwf-test",
    edgePrompt: `Do ${role}`,
    startedAtMs: Date.now(),
    completedAtMs: Date.now() + 1,
    cwd: storageRoot,
    assembledPrompt: null,
  })) as CasRef;

  setThread(uwf.varStore, threadId, { head: stepHash, suspendedRole: null, suspendMessage: null });
}

describe("currentRole field", () => {
  let tmpDir: string;
  let storageRoot: string;
  let casDir: string;
  let originalEnv: string | undefined;

  async function setup() {
    tmpDir = join(
      tmpdir(),
      `uwf-test-current-role-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    storageRoot = join(tmpDir, "storage");
    casDir = join(tmpDir, "cas");
    await mkdir(storageRoot, { recursive: true });
    await mkdir(casDir, { recursive: true });

    // Set OCAS_DIR for this test
    originalEnv = process.env.OCAS_DIR;
    process.env.OCAS_DIR = casDir;
  }

  async function teardown() {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env.OCAS_DIR;
    } else {
      process.env.OCAS_DIR = originalEnv;
    }
  }

  // T1: idle at start — currentRole = first role from graph
  test("thread show — idle at start returns first role as currentRole", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");
      const { thread } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);

      const result = await cmdThreadShow(storageRoot, thread as ThreadId);
      expect(result.status).toBe("idle");
      expect(result.currentRole).toBe("roleA");
    } finally {
      await teardown();
    }
  });

  // T2: idle after one step — currentRole = next role
  test("thread show — idle after step returns next role as currentRole", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");
      const { thread } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);

      await insertStepNode(storageRoot, thread as ThreadId, "roleA", { $status: "ready" });

      const result = await cmdThreadShow(storageRoot, thread as ThreadId);
      expect(result.status).toBe("idle");
      expect(result.currentRole).toBe("roleB");
    } finally {
      await teardown();
    }
  });

  // T3: completed → currentRole = null
  test("thread show — completed thread returns null currentRole", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");
      const { thread, workflow } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);
      const tid = thread as ThreadId;

      const uwfForIndex = await createUwfStore(storageRoot);
      const head = loadAllThreads(uwfForIndex.varStore)[tid]!.head;
      deleteThread(uwfForIndex.varStore, tid);
      addHistoryEntry(uwfForIndex.varStore, {
        thread: tid,
        workflow,
        head,
        completedAt: Date.now(),
        reason: "completed",
      });

      const result = await cmdThreadShow(storageRoot, tid);
      expect(result.status).toBe("completed");
      expect(result.currentRole).toBe(null);
    } finally {
      await teardown();
    }
  });

  // T4: cancelled → currentRole = null
  test("thread show — cancelled thread returns null currentRole", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");
      const { thread, workflow } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);
      const tid = thread as ThreadId;

      const uwfForIndex = await createUwfStore(storageRoot);
      const head = loadAllThreads(uwfForIndex.varStore)[tid]!.head;
      deleteThread(uwfForIndex.varStore, tid);
      addHistoryEntry(uwfForIndex.varStore, {
        thread: tid,
        workflow,
        head,
        completedAt: Date.now(),
        reason: "cancelled",
      });

      const result = await cmdThreadShow(storageRoot, tid);
      expect(result.status).toBe("cancelled");
      expect(result.currentRole).toBe(null);
    } finally {
      await teardown();
    }
  });

  // T5: running → currentRole = role being executed
  test("thread show — running thread returns current role", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");
      const { thread, workflow } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);
      const tid = thread as ThreadId;

      await createMarker(storageRoot, {
        thread: tid,
        workflow,
        pid: process.pid,
        startedAt: Date.now(),
      });

      try {
        const result = await cmdThreadShow(storageRoot, tid);
        expect(result.status).toBe("running");
        expect(result.currentRole).toBe("roleA");
      } finally {
        await deleteMarker(storageRoot, tid);
      }
    } finally {
      await teardown();
    }
  });

  // T6: thread list — mixed statuses with correct currentRole
  test("thread list — returns correct currentRole for each status", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");

      // idle thread
      const idle = await cmdThreadStart(storageRoot, wf, "idle", tmpDir);
      const idleId = idle.thread as ThreadId;

      // completed thread
      const comp = await cmdThreadStart(storageRoot, wf, "completed", tmpDir);
      const compId = comp.thread as ThreadId;
      const uwfForIndex = await createUwfStore(storageRoot);
      const compHead = loadAllThreads(uwfForIndex.varStore)[compId]!.head;
      deleteThread(uwfForIndex.varStore, compId);
      addHistoryEntry(uwfForIndex.varStore, {
        thread: compId,
        workflow: comp.workflow,
        head: compHead,
        completedAt: Date.now(),
        reason: "completed",
      });

      const list = await cmdThreadList(storageRoot, null, null, null, 0, 100);

      const idleItem = list.find((i) => i.thread === idleId);
      expect(idleItem).toBeDefined();
      expect(idleItem!.currentRole).toBe("roleA");

      const compItem = list.find((i) => i.thread === compId);
      expect(compItem).toBeDefined();
      expect(compItem!.currentRole).toBe(null);
    } finally {
      await teardown();
    }
  });

  // T7: thread list — idle at start has correct currentRole
  test("thread list — idle thread at start has correct currentRole", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-current-role.yaml");
      await writeFile(wf, SIMPLE_WORKFLOW_YAML, "utf8");
      const { thread } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);

      const list = await cmdThreadList(storageRoot, null, null, null, 0, 100);
      const item = list.find((i) => i.thread === (thread as ThreadId));
      expect(item).toBeDefined();
      expect(item!.currentRole).toBe("roleA");
    } finally {
      await teardown();
    }
  });

  // T8: conditional routing — $status=pass vs fail
  test("thread show — conditional routing selects correct next role", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-conditional-role.yaml");
      await writeFile(wf, CONDITIONAL_WORKFLOW_YAML, "utf8");

      // pass path
      const t1 = await cmdThreadStart(storageRoot, wf, "pass test", tmpDir);
      await insertStepNode(storageRoot, t1.thread as ThreadId, "roleA", { $status: "pass" });
      const r1 = await cmdThreadShow(storageRoot, t1.thread as ThreadId);
      expect(r1.currentRole).toBe("roleB");

      // fail path
      const t2 = await cmdThreadStart(storageRoot, wf, "fail test", tmpDir);
      await insertStepNode(storageRoot, t2.thread as ThreadId, "roleA", { $status: "fail" });
      const r2 = await cmdThreadShow(storageRoot, t2.thread as ThreadId);
      expect(r2.currentRole).toBe("roleC");
    } finally {
      await teardown();
    }
  });

  // T9: next role is $END → currentRole = null
  test("thread show — when next is $END, currentRole is null", async () => {
    await setup();
    try {
      const wf = join(tmpDir, "test-single-role.yaml");
      await writeFile(wf, SINGLE_ROLE_WORKFLOW_YAML, "utf8");

      const { thread } = await cmdThreadStart(storageRoot, wf, "test", tmpDir);
      // worker → _ maps to $END
      await insertStepNode(storageRoot, thread as ThreadId, "worker", {});

      const result = await cmdThreadShow(storageRoot, thread as ThreadId);
      expect(result.currentRole).toBe(null);
    } finally {
      await teardown();
    }
  });
});
