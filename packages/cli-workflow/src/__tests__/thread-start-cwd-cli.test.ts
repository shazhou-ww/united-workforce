import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, StartNodePayload, ThreadId } from "@uncaged/workflow-protocol";
import { describe, expect, test } from "vitest";
import { cmdThreadStart } from "../commands/thread.js";
import { createUwfStore, loadThreadsIndex } from "../store.js";

describe("thread start --cwd CLI option", () => {
  let tmpDir: string;
  let storageRoot: string;
  let casDir: string;
  let originalEnv: string | undefined;

  async function setupTestEnv() {
    tmpDir = join(tmpdir(), `uwf-test-cwd-cli-${Date.now()}`);
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

  async function createTestWorkflow(): Promise<string> {
    const workflowYaml = `
name: test-cwd-cli
description: Test workflow for CLI cwd option
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

    const workflowPath = join(tmpDir, "test-cwd-cli.yaml");
    await writeFile(workflowPath, workflowYaml, "utf8");
    return workflowPath;
  }

  async function getStartNodeCwd(threadId: string): Promise<string> {
    const uwf = await createUwfStore(storageRoot);
    const index = await loadThreadsIndex(storageRoot);
    const headHash = index[threadId as ThreadId]!.head;
    expect(headHash).toBeDefined();

    const startNode = uwf.store.get(headHash as CasRef);
    expect(startNode).not.toBe(null);
    expect(startNode?.type).toBe(uwf.schemas.startNode);

    const startPayload = startNode?.payload as StartNodePayload;
    return startPayload.cwd;
  }

  test("thread start with custom cwd via cmdThreadStart", async () => {
    await setupTestEnv();

    const workflowPath = await createTestWorkflow();
    const testCwd = "/test/custom/path";

    const result = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir, testCwd);

    expect(result.thread).toBeDefined();
    const actualCwd = await getStartNodeCwd(result.thread);
    expect(actualCwd).toBe(testCwd);

    await teardown();
  });

  test("thread start without cwd defaults to process.cwd()", async () => {
    await setupTestEnv();

    const workflowPath = await createTestWorkflow();

    // Call without cwd parameter (it defaults to process.cwd())
    const result = await cmdThreadStart(storageRoot, workflowPath, "test prompt", tmpDir);

    expect(result.thread).toBeDefined();
    const actualCwd = await getStartNodeCwd(result.thread);
    expect(actualCwd).toBe(process.cwd());

    await teardown();
  });

  test("thread start with relative path fails", async () => {
    await setupTestEnv();

    const workflowPath = await createTestWorkflow();

    await expect(
      cmdThreadStart(storageRoot, workflowPath, "test", tmpDir, "relative/path"),
    ).rejects.toThrow();

    await teardown();
  });

  test("CLI accepts --cwd option without error", async () => {
    await setupTestEnv();

    const workflowPath = await createTestWorkflow();
    const testCwd = "/test/cli/path";
    const uwfBin = join(process.cwd(), "dist", "cli.js");

    // Register the workflow
    execFileSync("node", [uwfBin, "workflow", "add", workflowPath], {
      env: { ...process.env, UWF_STORAGE_ROOT: storageRoot, UNCAGED_CAS_DIR: casDir },
      encoding: "utf8",
    });

    // Verify CLI accepts --cwd option (no error thrown)
    const output = execFileSync(
      "node",
      [uwfBin, "thread", "start", "test-cwd-cli", "-p", "test prompt", "--cwd", testCwd],
      {
        env: { ...process.env, UWF_STORAGE_ROOT: storageRoot, UNCAGED_CAS_DIR: casDir },
        encoding: "utf8",
      },
    );

    const result = JSON.parse(output);
    expect(result.thread).toBeDefined();
    expect(result.workflow).toBeDefined();

    // The fact that we got here without throwing means CLI accepted the --cwd option
    // The actual cwd functionality is tested by the other tests using cmdThreadStart directly
    await teardown();
  });
});
