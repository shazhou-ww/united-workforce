import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "@ocas/fs";
import type { CasRef, StartNodePayload, StepNodePayload } from "@united-workforce/protocol";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { cmdThreadStart } from "../commands/thread.js";
import { cmdWorkflowAdd } from "../commands/workflow.js";
import { createUwfStore, getThread } from "../store.js";

// ── paths ──────────────────────────────────────────────────────────────────

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(TEST_DIR, "fixtures");
const CLI_PATH = join(TEST_DIR, "..", "..", "dist", "cli.js");
const REPO_ROOT = join(TEST_DIR, "..", "..", "..", "..");
const AGENT_MOCK_DIR = join(REPO_ROOT, "packages", "agent-mock");
const AGENT_MOCK_CLI = join(AGENT_MOCK_DIR, "dist", "cli.js");

// ── shared fixture state ─────────────────────────────────────────────────────

let tmpDir: string;
let uwfHome: string;
let casDir: string;
let savedEnv: { uwf: string | undefined; ocas: string | undefined };

/**
 * The mock agent runs from its built `dist/cli.js`. When the test suite runs
 * standalone (no prior `pnpm run build`), build it on demand so the E2E run is
 * self-contained.
 */
beforeAll(() => {
  if (existsSync(AGENT_MOCK_CLI)) {
    return;
  }
  execFileSync(
    process.execPath,
    [
      join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"),
      "--build",
      "--force",
      AGENT_MOCK_DIR,
    ],
    { cwd: REPO_ROOT, stdio: "ignore" },
  );
}, 120000);

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-e2e-mock-"));
  uwfHome = join(tmpDir, "uwf");
  casDir = join(tmpDir, "ocas");
  await mkdir(uwfHome, { recursive: true });
  await mkdir(casDir, { recursive: true });
  // Programmatic CLI APIs (cmdWorkflowAdd, cmdThreadStart) read the global CAS
  // directory from OCAS_HOME and the storage root from UWF_HOME.
  savedEnv = { uwf: process.env.UWF_HOME, ocas: process.env.OCAS_HOME };
  process.env.UWF_HOME = uwfHome;
  process.env.OCAS_HOME = casDir;
});

afterEach(async () => {
  process.env.UWF_HOME = savedEnv.uwf;
  process.env.OCAS_HOME = savedEnv.ocas;
  await rm(tmpDir, { recursive: true, force: true });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Write a `config.yaml` into UWF_HOME that wires the default agent to the mock
 * agent. The mock data path is baked into the agent args so the CLI's
 * `thread exec` (without an `--agent` override) resolves it from config.
 */
async function writeMockConfig(mockDataFixture: string): Promise<void> {
  const config = {
    defaultAgent: "mock",
    defaultModel: "test",
    providers: {},
    models: {},
    agentOverrides: null,
    agents: {
      mock: {
        command: process.execPath,
        args: [AGENT_MOCK_CLI, "--mock-data", join(FIXTURES_DIR, mockDataFixture)],
      },
    },
  };
  await writeFile(join(uwfHome, "config.yaml"), stringify(config));
}

/**
 * `cmdWorkflowAdd` enforces filename↔name consistency, so copy the fixture into
 * UWF_HOME under `<workflow-name>.yaml` before registering it.
 */
async function addWorkflow(workflowFixture: string, workflowName: string): Promise<CasRef> {
  const text = await readFile(join(FIXTURES_DIR, workflowFixture), "utf8");
  const filePath = join(uwfHome, `${workflowName}.yaml`);
  await writeFile(filePath, text);
  const result = await cmdWorkflowAdd(uwfHome, filePath);
  return result.hash;
}

type ExecResult = { stdout: string; stderr: string; exitCode: number };

function runExec(threadId: string): ExecResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, "thread", "exec", threadId], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, UWF_HOME: uwfHome, OCAS_HOME: casDir },
      cwd: tmpDir,
      timeout: 30000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

type StepOutputJson = {
  thread: string;
  head: string;
  status: string;
  currentRole: string | null;
  done: boolean;
};

function execStep(threadId: string): StepOutputJson {
  const { stdout, stderr, exitCode } = runExec(threadId);
  if (exitCode !== 0) {
    throw new Error(`thread exec failed (code ${exitCode})\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  return JSON.parse(stdout.trim()) as StepOutputJson;
}

function getStepNode(store: Awaited<ReturnType<typeof openStore>>, hash: string): StepNodePayload {
  const node = store.cas.get(hash as CasRef);
  expect(node).not.toBeNull();
  return node!.payload as StepNodePayload;
}

function getStatus(store: Awaited<ReturnType<typeof openStore>>, outputRef: CasRef): unknown {
  const node = store.cas.get(outputRef);
  expect(node).not.toBeNull();
  return (node!.payload as Record<string, unknown>).$status;
}

// ── scenarios ─────────────────────────────────────────────────────────────────

describe("E2E mock-agent: full uwf pipeline", () => {
  test("1. linear workflow runs planner then worker and reaches $END", async () => {
    await writeMockConfig("e2e-linear.mock.yaml");
    const workflowHash = await addWorkflow("e2e-linear.workflow.yaml", "test-linear");

    const start = await cmdThreadStart(uwfHome, workflowHash, "Build the thing", uwfHome, tmpDir);
    const threadId = start.thread;

    // Capture the start node hash (thread head before any step).
    const startHash = getThread((await createUwfStore(uwfHome)).varStore, threadId)?.head;
    expect(startHash).toBeDefined();

    // Step 1 → planner.
    const step1 = execStep(threadId);
    expect(step1.thread).toBe(threadId);
    expect(step1.done).toBe(false);
    expect(step1.status).toBe("idle");
    expect(step1.currentRole).toBe("worker");

    // Step 2 → worker → $END (thread archived to history).
    const step2 = execStep(threadId);
    expect(step2.done).toBe(true);
    expect(step2.status).toBe("completed");
    expect(step2.currentRole).toBeNull();

    // Verify CAS chain integrity: start → step1 → step2.
    const store = await openStore(casDir);
    const s1 = getStepNode(store, step1.head);
    const s2 = getStepNode(store, step2.head);

    expect(s1.role).toBe("planner");
    expect(s1.prev).toBeNull();
    expect(s1.start).toBe(startHash);

    expect(s2.role).toBe("worker");
    expect(s2.prev).toBe(step1.head);
    expect(s2.start).toBe(s1.start);

    // Output frontmatter statuses persisted correctly.
    expect(getStatus(store, s1.output)).toBe("ready");
    expect(getStatus(store, s2.output)).toBe("done");

    // The start node points at the registered workflow.
    const startNode = store.cas.get(startHash as CasRef);
    expect((startNode!.payload as StartNodePayload).workflow).toBe(workflowHash);

    // Thread is completed: status changed to "completed", head updated.
    const uwf = await createUwfStore(uwfHome);
    const finalEntry = getThread(uwf.varStore, threadId);
    expect(finalEntry).not.toBeNull();
    expect(finalEntry!.status).toBe("completed");
    expect(finalEntry!.head).toBe(step2.head);
  });

  test("2. branching workflow loops developer→reviewer→developer→reviewer→$END", async () => {
    await writeMockConfig("e2e-loop.mock.yaml");
    const workflowHash = await addWorkflow("e2e-loop.workflow.yaml", "test-loop");

    const start = await cmdThreadStart(uwfHome, workflowHash, "Implement feature", uwfHome, tmpDir);
    const threadId = start.thread;

    // 4 steps: developer, reviewer (rejected → loop), developer, reviewer (approved → $END).
    const s1 = execStep(threadId);
    expect(s1.status).toBe("idle");
    expect(s1.currentRole).toBe("reviewer");

    const s2 = execStep(threadId);
    expect(s2.status).toBe("idle");
    // reviewer rejected → loops back to developer.
    expect(s2.currentRole).toBe("developer");

    const s3 = execStep(threadId);
    expect(s3.status).toBe("idle");
    expect(s3.currentRole).toBe("reviewer");

    const s4 = execStep(threadId);
    expect(s4.done).toBe(true);
    expect(s4.status).toBe("completed");

    // Verify the chain order and roles.
    const store = await openStore(casDir);
    const n1 = getStepNode(store, s1.head);
    const n2 = getStepNode(store, s2.head);
    const n3 = getStepNode(store, s3.head);
    const n4 = getStepNode(store, s4.head);

    expect([n1.role, n2.role, n3.role, n4.role]).toEqual([
      "developer",
      "reviewer",
      "developer",
      "reviewer",
    ]);
    expect(n1.prev).toBeNull();
    expect(n2.prev).toBe(s1.head);
    expect(n3.prev).toBe(s2.head);
    expect(n4.prev).toBe(s3.head);

    // All steps share the same start node.
    expect(new Set([n1.start, n2.start, n3.start, n4.start]).size).toBe(1);

    // Statuses drove the loop routing.
    expect(getStatus(store, n1.output)).toBe("review_needed");
    expect(getStatus(store, n2.output)).toBe("rejected");
    expect(getStatus(store, n3.output)).toBe("review_needed");
    expect(getStatus(store, n4.output)).toBe("approved");

    const uwf = await createUwfStore(uwfHome);
    const finalEntry = getThread(uwf.varStore, threadId);
    expect(finalEntry).not.toBeNull();
    expect(finalEntry!.status).toBe("completed");
  });

  test("3. role mismatch in mock data makes the agent exit with an error", async () => {
    // Reuses the linear workflow but with a mock whose step[1].role is wrong.
    await writeMockConfig("e2e-mismatch.mock.yaml");
    const workflowHash = await addWorkflow("e2e-linear.workflow.yaml", "test-linear");

    const start = await cmdThreadStart(uwfHome, workflowHash, "Build the thing", uwfHome, tmpDir);
    const threadId = start.thread;

    // Step 1 (planner) matches and succeeds.
    const step1 = execStep(threadId);
    expect(step1.status).toBe("idle");
    expect(step1.currentRole).toBe("worker");

    // Step 2: moderator routes to "worker" but mock step[1].role is "planner".
    const result = runExec(threadId);
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/expected role "planner"/);

    // The thread remains active (no step node was written for the failed step).
    const uwf = await createUwfStore(uwfHome);
    const entry = getThread(uwf.varStore, threadId);
    expect(entry).not.toBeNull();
    expect(entry!.status).not.toBe("completed");
    expect(entry!.head).toBe(step1.head);
  });
});
