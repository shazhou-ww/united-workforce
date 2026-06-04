import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";
import { createMarker, deleteMarker } from "../background/index.js";
import { cmdThreadShow, cmdThreadStart } from "../commands/thread.js";
import {
  completeThread,
  createUwfStore,
  loadAllThreads,
  setThread,
} from "../store.js";

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    $status: { type: "string" as const },
    question: { type: "string" as const },
  },
};

const TEST_WORKFLOW_YAML = `
name: test-status
description: Test workflow for status field
roles:
  planner:
    description: Plans the work
    goal: Plan implementation
    capabilities: ["planning"]
    procedure: Plan
    output: |
      $status: "ready"
    frontmatter:
      type: object
      required: ["$status"]
      properties:
        $status: { type: string }
graph:
  $START:
    _:
      role: planner
      prompt: "Plan the work"
      location: null
  planner:
    _:
      role: $END
      prompt: "Done"
      location: null
`;

const SUSPEND_WORKFLOW_YAML = `
name: test-suspend-status
description: Test workflow for suspended status
roles:
  worker:
    description: Worker role
    goal: Work
    capabilities: ["coding"]
    procedure: Work
    output: |
      $status: "needs_input"
      question: "Which API?"
    frontmatter:
      oneOf:
        - type: object
          required: ["$status", "question"]
          properties:
            $status: { const: "needs_input" }
            question: { type: string }
graph:
  $START:
    _:
      role: worker
      prompt: "Start work"
      location: null
  worker:
    needs_input:
      role: $SUSPEND
      prompt: "Please clarify: {{{question}}}"
      location: null
`;

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
  const detailHash = await uwf.store.cas.put(uwf.schemas.text, "detail-placeholder");

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
    edgePrompt: "edge",
    startedAtMs: Date.now(),
    completedAtMs: Date.now() + 1,
    cwd: "/tmp",
    assembledPrompt: null,
  })) as CasRef;

  setThread(uwf.varStore, threadId, {
    head: stepHash,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });
}

describe("thread show status field", () => {
  let tmpDir: string;
  let storageRoot: string;

  async function setupTestEnv() {
    tmpDir = join(tmpdir(), `uwf-test-status-${Date.now()}`);
    storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });
  }

  async function teardown() {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  test("active idle thread shows status 'idle'", async () => {
    await setupTestEnv();

    const workflowPath = join(tmpDir, "test-status.yaml");
    await writeFile(workflowPath, TEST_WORKFLOW_YAML, "utf8");

    // Create a thread
    const startResult = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);
    const threadId = startResult.thread as ThreadId;

    // Show the thread (should be idle)
    const result = await cmdThreadShow(storageRoot, threadId);

    expect(result.status).toBe("idle");
    expect(result.done).toBe(false);
    expect(result.background).toBe(null);
    expect(result.thread).toBe(threadId);

    await teardown();
  });

  test("active running thread shows status 'running'", async () => {
    await setupTestEnv();

    const workflowPath = join(tmpDir, "test-status.yaml");
    await writeFile(workflowPath, TEST_WORKFLOW_YAML, "utf8");

    // Create a thread
    const startResult = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);
    const threadId = startResult.thread as ThreadId;
    const workflow = startResult.workflow;

    // Create a running marker
    await createMarker(storageRoot, {
      thread: threadId,
      workflow,
      pid: process.pid,
      startedAt: Date.now(),
    });

    try {
      const result = await cmdThreadShow(storageRoot, threadId);

      expect(result.status).toBe("running");
      expect(result.done).toBe(false);
      expect(result.background).toBe(null);
      expect(result.thread).toBe(threadId);
    } finally {
      // Cleanup: delete marker
      await deleteMarker(storageRoot, threadId);
      await teardown();
    }
  });

  test("completed thread shows status 'completed'", async () => {
    await setupTestEnv();

    const workflowPath = join(tmpDir, "test-status.yaml");
    await writeFile(workflowPath, TEST_WORKFLOW_YAML, "utf8");

    // Create a thread
    const startResult = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);
    const threadId = startResult.thread as ThreadId;
    const workflow = startResult.workflow;

    // Get the head hash before moving to history
    const uwfForIndex = await createUwfStore(storageRoot);
    const index = loadAllThreads(uwfForIndex.varStore);
    const head = index[threadId]!.head;
    if (!head) throw new Error("Thread not found in index");

    completeThread(uwfForIndex.varStore, threadId, "completed");

    const result = await cmdThreadShow(storageRoot, threadId);

    expect(result.status).toBe("completed");
    expect(result.done).toBe(true);
    expect(result.background).toBe(null);
    expect(result.thread).toBe(threadId);

    await teardown();
  });

  test("cancelled thread shows status 'cancelled'", async () => {
    await setupTestEnv();

    const workflowPath = join(tmpDir, "test-status.yaml");
    await writeFile(workflowPath, TEST_WORKFLOW_YAML, "utf8");

    // Create a thread
    const startResult = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);
    const threadId = startResult.thread as ThreadId;
    const workflow = startResult.workflow;

    // Get the head hash before moving to history
    const uwfForIndex = await createUwfStore(storageRoot);
    const index = loadAllThreads(uwfForIndex.varStore);
    const head = index[threadId]!.head;
    if (!head) throw new Error("Thread not found in index");

    completeThread(uwfForIndex.varStore, threadId, "cancelled");

    const result = await cmdThreadShow(storageRoot, threadId);

    expect(result.status).toBe("cancelled");
    expect(result.done).toBe(true);
    expect(result.background).toBe(null);
    expect(result.thread).toBe(threadId);

    await teardown();
  });

  test("legacy completed thread without reason shows status 'completed'", async () => {
    await setupTestEnv();

    const workflowPath = join(tmpDir, "test-status.yaml");
    await writeFile(workflowPath, TEST_WORKFLOW_YAML, "utf8");

    // Create a thread
    const startResult = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);
    const threadId = startResult.thread as ThreadId;
    const workflow = startResult.workflow;

    // Get the head hash before moving to history
    const uwfForIndex = await createUwfStore(storageRoot);
    const index = loadAllThreads(uwfForIndex.varStore);
    const head = index[threadId]!.head;
    if (!head) throw new Error("Thread not found in index");

    completeThread(uwfForIndex.varStore, threadId, "completed");

    const result = await cmdThreadShow(storageRoot, threadId);

    expect(result.status).toBe("completed");
    expect(result.done).toBe(true);
    expect(result.background).toBe(null);

    await teardown();
  });

  test("active suspended thread shows status 'suspended'", async () => {
    await setupTestEnv();
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const originalCasDir = process.env.OCAS_DIR;
    process.env.OCAS_DIR = casDir;

    try {
      const workflowPath = join(tmpDir, "test-suspend-status.yaml");
      await writeFile(workflowPath, SUSPEND_WORKFLOW_YAML, "utf8");

      const startResult = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);
      const threadId = startResult.thread as ThreadId;

      await insertStepNode(storageRoot, threadId, "worker", {
        $status: "needs_input",
        question: "Which API?",
      });

      const result = await cmdThreadShow(storageRoot, threadId);

      expect(result.status).toBe("suspended");
      expect(result.done).toBe(false);
      expect(result.currentRole).toBe(null);
      expect(result.suspendedRole).toBe("worker");
      expect(result.suspendMessage).toBe("Please clarify: Which API?");
      expect(result.background).toBe(null);
      expect(result.thread).toBe(threadId);
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_DIR;
      } else {
        process.env.OCAS_DIR = originalCasDir;
      }
      await teardown();
    }
  });
});
