import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, StartNodePayload, ThreadId } from "@uncaged/workflow-protocol";
import { describe, expect, test } from "vitest";
import { cmdThreadStart } from "../commands/thread.js";
import { createUwfStore } from "../store.js";

describe("Thread and edge location integration", () => {
  let tmpDir: string;
  let storageRoot: string;
  let casDir: string;
  let originalEnv: string | undefined;

  async function setupTestEnv() {
    tmpDir = join(tmpdir(), `uwf-test-location-${Date.now()}`);
    storageRoot = join(tmpDir, "storage");
    casDir = join(tmpDir, "cas");
    await mkdir(storageRoot, { recursive: true });
    await mkdir(casDir, { recursive: true });

    // Set UNCAGED_CAS_DIR for this test
    originalEnv = process.env.UNCAGED_CAS_DIR;
    process.env.UNCAGED_CAS_DIR = casDir;
  }

  async function teardown() {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env.UNCAGED_CAS_DIR;
    } else {
      process.env.UNCAGED_CAS_DIR = originalEnv;
    }
  }

  test("thread start captures cwd in StartNode", async () => {
    await setupTestEnv();

    const workflowYaml = `
name: test-location
description: Test workflow for location feature
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

    const workflowPath = join(tmpDir, "test-location.yaml");
    await writeFile(workflowPath, workflowYaml, "utf8");

    const testCwd = "/test/project/path";
    const result = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir, testCwd);

    expect(result.thread).toBeDefined();
    expect(result.workflow).toBeDefined();

    // Verify StartNode has the cwd field
    const uwf = await createUwfStore(storageRoot);
    const index = await import("../store.js").then((m) => m.loadThreadsIndex(storageRoot));
    const headHash = index[result.thread as ThreadId];
    expect(headHash).toBeDefined();

    const startNode = uwf.store.get(headHash as CasRef);
    expect(startNode).not.toBe(null);
    expect(startNode?.type).toBe(uwf.schemas.startNode);

    const startPayload = startNode?.payload as StartNodePayload;
    expect(startPayload.cwd).toBe(testCwd);

    await teardown();
  });

  test("thread start validates cwd is absolute path", async () => {
    await setupTestEnv();

    const workflowYaml = `
name: test-location
description: Test workflow
roles:
  planner:
    description: Plans
    goal: Plan
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
      prompt: "Plan"
      location: null
  planner:
    _:
      role: $END
      prompt: "Done"
      location: null
`;

    const workflowPath = join(tmpDir, "test-location.yaml");
    await writeFile(workflowPath, workflowYaml, "utf8");

    // Relative path should fail (process.exit is wrapped by vitest)
    await expect(
      cmdThreadStart(storageRoot, workflowPath, "test", tmpDir, "relative/path"),
    ).rejects.toThrow();

    await teardown();
  });

  test("thread start uses process.cwd() as default", async () => {
    await setupTestEnv();

    const workflowYaml = `
name: test-default-cwd
description: Test default cwd
roles:
  planner:
    description: Plans
    goal: Plan
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
      prompt: "Plan"
      location: null
  planner:
    _:
      role: $END
      prompt: "Done"
      location: null
`;

    const workflowPath = join(tmpDir, "test-default-cwd.yaml");
    await writeFile(workflowPath, workflowYaml, "utf8");

    const result = await cmdThreadStart(storageRoot, workflowPath, "test", tmpDir);

    const uwf = await createUwfStore(storageRoot);
    const index = await import("../store.js").then((m) => m.loadThreadsIndex(storageRoot));
    const headHash = index[result.thread as ThreadId];

    const startNode = uwf.store.get(headHash as CasRef);
    const startPayload = startNode?.payload as StartNodePayload;

    // Should default to process.cwd()
    expect(startPayload.cwd).toBe(process.cwd());

    await teardown();
  });
});
