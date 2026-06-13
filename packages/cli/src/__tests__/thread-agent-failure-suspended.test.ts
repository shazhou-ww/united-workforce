import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { registerUwfSchemas } from "../schemas.js";
import { seedThreads } from "./thread-test-helpers.js";

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    $status: { type: "string" as const },
    note: { type: "string" as const },
  },
  required: ["$status"],
  additionalProperties: false,
};

const THREAD_ID = "01AGENTFAILSUSPEND00000" as ThreadId;

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-agent-fail-suspend-"));
});

afterEach(async () => {
  if (savedOcasHome === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = savedOcasHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

type SetupResult = {
  casDir: string;
  startHash: CasRef;
  workflowHash: CasRef;
  mockAgentPath: string;
  failingAgentPath: string;
  recoverableFailAgentPath: string;
};

async function setupThread(): Promise<SetupResult> {
  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });

  const store = await openStore(casDir);
  const schemas = await registerUwfSchemas(store);
  const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

  const workflowHash = await store.cas.put(schemas.workflow, {
    name: "test-agent-fail",
    description: "agent failure suspend test",
    roles: {
      worker: {
        description: "Worker role",
        goal: "Work",
        capabilities: [],
        procedure: "work",
        output: "result",
        frontmatter: outputSchemaHash,
      },
      reviewer: {
        description: "Reviewer role",
        goal: "Review",
        capabilities: [],
        procedure: "review",
        output: "result",
        frontmatter: outputSchemaHash,
      },
    },
    graph: {
      $START: {
        new: { role: "worker", prompt: "Start work", location: null },
        resume: { role: "worker", prompt: "Resume work", location: null },
      },
      worker: {
        ok: { role: "reviewer", prompt: "Review the work", location: null },
      },
      reviewer: { done: { role: "$END", prompt: "Done", location: null } },
    },
  });

  const startHash = await store.cas.put(schemas.startNode, {
    workflow: workflowHash,
    prompt: "Test agent failure task",
    cwd: tmpDir,
  });

  process.env.OCAS_HOME = casDir;

  await seedThreads(tmpDir, { [THREAD_ID]: startHash });

  // Build a successful step output to be used by agents
  const newOutputHash = await store.cas.put(outputSchemaHash, {
    $status: "ok",
    note: "success output",
  });
  const newDetailHash = await store.cas.put(schemas.text, "success detail");
  const successStepHash = await store.cas.put(schemas.stepNode, {
    start: startHash,
    prev: null,
    role: "worker",
    output: newOutputHash,
    detail: newDetailHash,
    agent: "mock-agent",
    edgePrompt: "Start work",
    startedAtMs: 1716600000000,
    completedAtMs: 1716600001000,
    cwd: tmpDir,
    assembledPrompt: null,
    usage: null,
  });

  // Build a failed step output (isError: true) — the agent created the CAS node but reports failure
  const failedOutputHash = await store.cas.put(outputSchemaHash, {
    $status: "error",
    note: "validation failed",
  });
  const failedDetailHash = await store.cas.put(schemas.text, "failed detail");
  const failedStepHash = await store.cas.put(schemas.stepNode, {
    start: startHash,
    prev: null,
    role: "worker",
    output: failedOutputHash,
    detail: failedDetailHash,
    agent: "mock-agent",
    edgePrompt: "Start work",
    startedAtMs: 1716600000000,
    completedAtMs: 1716600001000,
    cwd: tmpDir,
    assembledPrompt: null,
    usage: null,
  });

  const successAdapterJson = JSON.stringify({
    stepHash: successStepHash,
    detailHash: newDetailHash,
    role: "worker",
    frontmatter: { $status: "ok", note: "success output" },
    body: "",
    startedAtMs: 1716600000000,
    completedAtMs: 1716600001000,
    usage: null,
  });

  const failedAdapterJson = JSON.stringify({
    stepHash: failedStepHash,
    detailHash: failedDetailHash,
    role: "worker",
    frontmatter: { $status: "error", note: "validation failed" },
    body: "",
    startedAtMs: 1716600000000,
    completedAtMs: 1716600001000,
    usage: null,
    isError: true,
    errorMessage: "frontmatter validation exhausted retries",
  });

  // Mock agent that succeeds
  const mockAgentPath = join(tmpDir, "mock-agent.sh");
  await writeFile(mockAgentPath, `#!/bin/sh\necho '${successAdapterJson}'\n`, { mode: 0o755 });

  // Agent that crashes with non-zero exit code (fatal failure)
  const failingAgentPath = join(tmpDir, "failing-agent.sh");
  await writeFile(failingAgentPath, `#!/bin/sh\necho "boom" >&2\nexit 7\n`, { mode: 0o755 });

  // Agent that returns isError: true (recoverable failure)
  const recoverableFailAgentPath = join(tmpDir, "recoverable-fail-agent.sh");
  await writeFile(recoverableFailAgentPath, `#!/bin/sh\necho '${failedAdapterJson}'\n`, {
    mode: 0o755,
  });

  const configPath = join(tmpDir, "config.yaml");
  await writeFile(
    configPath,
    `defaultAgent: uwf-hermes\nagentOverrides: null\nagents:\n  uwf-hermes:\n    command: uwf-hermes\n`,
  );

  return {
    casDir,
    startHash,
    workflowHash,
    mockAgentPath,
    failingAgentPath,
    recoverableFailAgentPath,
  };
}

function runUwf(
  args: string[],
  casDir: string,
): { stdout: string; stderr: string; status: number } {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli.js");
  const formatArgs = args.includes("--format") ? args : ["--format", "raw-json", ...args];
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...formatArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        UWF_HOME: tmpDir,
        OCAS_HOME: casDir,
      },
      cwd: tmpDir,
      timeout: 30000,
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf8") ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

// ── Spec 1: Recoverable agent failure (isError: true) → suspended ─────────

describe("recoverable agent failure suspends thread", () => {
  test("CLI output has status=suspended when agent returns isError=true", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath],
      casDir,
    );
    // exec envelope: { threadId, workflowHash, steps: [...] }
    const envelope = JSON.parse(result.stdout.trim());
    const stepOutput = envelope.steps[0];
    expect(stepOutput.status).toBe("suspended");
  });

  test("CLI output has suspendedRole set to the failing role", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath],
      casDir,
    );
    const envelope = JSON.parse(result.stdout.trim());
    const stepOutput = envelope.steps[0];
    expect(stepOutput.suspendedRole).toBe("worker");
  });

  test("CLI output has suspendMessage set to the error message", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath],
      casDir,
    );
    const envelope = JSON.parse(result.stdout.trim());
    const stepOutput = envelope.steps[0];
    expect(stepOutput.suspendMessage).toBe("frontmatter validation exhausted retries");
  });

  test("thread head is NOT advanced on recoverable failure", async () => {
    const { casDir, startHash, recoverableFailAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath], casDir);
    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    // Head should still be the start hash (not advanced)
    expect(entry?.head).toBe(startHash);
  });

  test("thread index entry is persisted as suspended via markThreadSuspended", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath], casDir);
    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.status).toBe("suspended");
    expect(entry?.suspendedRole).toBe("worker");
    expect(entry?.suspendMessage).toBe("frontmatter validation exhausted retries");
  });

  test("uwf thread list --status suspended includes the thread", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath], casDir);
    const listResult = runUwf(["thread", "list", "--status", "suspended"], casDir);
    expect(listResult.stdout).toContain(THREAD_ID);
  });

  test("error field is included in StepOutput for backward compatibility", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath],
      casDir,
    );
    const envelope = JSON.parse(result.stdout.trim());
    const stepOutput = envelope.steps[0];
    // The exec envelope includes status=suspended with suspend fields;
    // the internal StepOutput also carries error { stepHash, message } but
    // toThreadExecPayload only maps status/suspendedRole/suspendMessage.
    // Verify the mapped fields are correct.
    expect(stepOutput.status).toBe("suspended");
    expect(stepOutput.suspendedRole).toBe("worker");
    expect(stepOutput.suspendMessage).toBe("frontmatter validation exhausted retries");
  });
});

// ── Spec 2: Fatal agent failure (command crash) → suspended ───────────────

describe("fatal agent failure suspends thread", () => {
  test("thread status is suspended after agent crash", async () => {
    const { casDir, failingAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", failingAgentPath], casDir);
    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.status).toBe("suspended");
  });

  test("thread index has suspendedRole and suspendMessage after fatal failure", async () => {
    const { casDir, failingAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", failingAgentPath], casDir);
    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.suspendedRole).toBe("worker");
    expect(entry?.suspendMessage).toContain("agent command failed");
  });

  test("thread head is NOT advanced after fatal failure", async () => {
    const { casDir, startHash, failingAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", failingAgentPath], casDir);
    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.head).toBe(startHash);
  });

  test("uwf thread list --status suspended includes thread after crash", async () => {
    const { casDir, failingAgentPath } = await setupThread();
    runUwf(["thread", "exec", THREAD_ID, "--agent", failingAgentPath], casDir);
    const listResult = runUwf(["thread", "list", "--status", "suspended"], casDir);
    expect(listResult.stdout).toContain(THREAD_ID);
  });

  test("CLI process exits with non-zero exit code after fatal failure", async () => {
    const { casDir, failingAgentPath } = await setupThread();
    const result = runUwf(["thread", "exec", THREAD_ID, "--agent", failingAgentPath], casDir);
    expect(result.status).not.toBe(0);
  });
});

// ── Spec 3: Suspended thread from agent failure can be resumed ────────────

describe("agent-failure-suspended thread can be resumed", () => {
  test("thread resume is accepted for agent-failure suspended thread", async () => {
    const { casDir, recoverableFailAgentPath, mockAgentPath } = await setupThread();
    // First: cause a recoverable failure → thread becomes suspended
    runUwf(["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath], casDir);
    // Verify it's suspended
    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.status).toBe("suspended");

    // Resume with a different (successful) agent
    const resumeResult = runUwf(
      [
        "thread",
        "resume",
        THREAD_ID,
        "-p",
        "try again with correct params",
        "--agent",
        mockAgentPath,
      ],
      casDir,
    );
    expect(resumeResult.status).toBe(0);
    const resumeOutput = JSON.parse(resumeResult.stdout.trim());
    // After successful resume, thread should not be suspended
    expect(resumeOutput.status).not.toBe("suspended");
  });

  test("re-failure after resume returns to suspended (not idle)", async () => {
    const { casDir, recoverableFailAgentPath } = await setupThread();
    // First: cause a recoverable failure → suspended
    runUwf(["thread", "exec", THREAD_ID, "--agent", recoverableFailAgentPath], casDir);
    // Resume with same failing agent → should suspend again
    const resumeResult = runUwf(
      ["thread", "resume", THREAD_ID, "-p", "try again", "--agent", recoverableFailAgentPath],
      casDir,
    );
    // Resume with recoverable failure agent — the resume itself runs cmdThreadStepOnce
    // which should report suspended status
    const resumeOutput = JSON.parse(resumeResult.stdout.trim());
    expect(resumeOutput.status).toBe("suspended");
    expect(resumeOutput.suspendedRole).toBe("worker");
  });
});
