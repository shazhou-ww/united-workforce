import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadId } from "@uncaged/workflow-protocol";
import { describe, expect, test } from "vitest";
import { createMarker, deleteMarker } from "../background/index.js";
import { cmdThreadShow, cmdThreadStart } from "../commands/thread.js";
import { appendThreadHistory, loadThreadsIndex } from "../store.js";

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
    const index = await loadThreadsIndex(storageRoot);
    const head = index[threadId];
    if (!head) throw new Error("Thread not found in index");

    // Move thread to history with reason 'completed'
    const { saveThreadsIndex } = await import("../store.js");
    const newIndex = { ...index };
    delete newIndex[threadId];
    await saveThreadsIndex(storageRoot, newIndex);

    await appendThreadHistory(storageRoot, {
      thread: threadId,
      workflow,
      head,
      completedAt: Date.now(),
      reason: "completed",
    });

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
    const index = await loadThreadsIndex(storageRoot);
    const head = index[threadId];
    if (!head) throw new Error("Thread not found in index");

    // Move thread to history with reason 'cancelled'
    const { saveThreadsIndex } = await import("../store.js");
    const newIndex = { ...index };
    delete newIndex[threadId];
    await saveThreadsIndex(storageRoot, newIndex);

    await appendThreadHistory(storageRoot, {
      thread: threadId,
      workflow,
      head,
      completedAt: Date.now(),
      reason: "cancelled",
    });

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
    const index = await loadThreadsIndex(storageRoot);
    const head = index[threadId];
    if (!head) throw new Error("Thread not found in index");

    // Move thread to history with reason null (legacy format)
    const { saveThreadsIndex } = await import("../store.js");
    const newIndex = { ...index };
    delete newIndex[threadId];
    await saveThreadsIndex(storageRoot, newIndex);

    await appendThreadHistory(storageRoot, {
      thread: threadId,
      workflow,
      head,
      completedAt: Date.now(),
      reason: null,
    });

    const result = await cmdThreadShow(storageRoot, threadId);

    expect(result.status).toBe("completed");
    expect(result.done).toBe(true);
    expect(result.background).toBe(null);

    await teardown();
  });
});
