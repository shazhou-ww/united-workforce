import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, StepNodePayload, ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdThreadShow } from "../commands/thread.js";
import { registerUwfSchemas } from "../schemas.js";
import { seedThreads } from "./thread-test-helpers.js";

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    $status: { type: "string" as const },
    question: { type: "string" as const },
  },
  required: ["$status"],
  additionalProperties: false,
};

const THREAD_ID = "01RESUMESTEPTEST0000000" as ThreadId;
const SUSPEND_MESSAGE = "Please clarify: Which API?";

type MockAgentMode = "suspend" | "ok";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-resume-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function setupSuspendedThread(mode: MockAgentMode): Promise<{
  casDir: string;
  mockAgentPath: string;
  promptCapturePath: string;
}> {
  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });

  const store = await openStore(casDir);
  const schemas = await registerUwfSchemas(store);
  const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

  const workflowHash = await store.cas.put(schemas.workflow, {
    name: "test-resume",
    description: "resume command integration test",
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
        resume: { role: "worker", prompt: "Resume the work", location: null },
      },
      worker: {
        ok: { role: "reviewer", prompt: "Review the work", location: null },
      },
      reviewer: { done: { role: "$END", prompt: "Done", location: null } },
    },
  });

  const startHash = await store.cas.put(schemas.startNode, {
    workflow: workflowHash,
    prompt: "Test resume task",
    cwd: tmpDir,
  });

  process.env.OCAS_HOME = casDir;
  await seedThreads(tmpDir, { [THREAD_ID]: startHash });

  const outputHash = await store.cas.put(schemas.suspendOutput, {
    $status: "$SUSPEND",
    reason: SUSPEND_MESSAGE,
  });
  const detailHash = await store.cas.put(schemas.text, "mock detail");

  const startedAtMs = 1716600000000;
  const completedAtMs = 1716600001500;

  const stepHash = await store.cas.put(schemas.stepNode, {
    start: startHash,
    prev: null,
    role: "worker",
    output: outputHash,
    detail: detailHash,
    agent: "uwf-mock",
    edgePrompt: "Start work",
    startedAtMs,
    completedAtMs,
    cwd: tmpDir,
    assembledPrompt: null,
  });

  await seedThreads(tmpDir, {
    [THREAD_ID]: {
      head: stepHash,
      status: "suspended",
      suspendedRole: "worker",
      suspendMessage: SUSPEND_MESSAGE,
      completedAt: null,
    },
  });

  const promptCapturePath = join(tmpDir, "captured-prompt.txt");
  const mockAgentPath = join(tmpDir, "mock-agent.sh");

  const frontmatter =
    mode === "suspend" ? { $status: "$SUSPEND", reason: SUSPEND_MESSAGE } : { $status: "ok" };
  const frontmatterSchema = mode === "suspend" ? schemas.suspendOutput : outputSchemaHash;

  const adapterJson = JSON.stringify({
    stepHash: await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: stepHash,
      role: "worker",
      output: await store.cas.put(frontmatterSchema, frontmatter),
      detail: detailHash,
      agent: "uwf-mock",
      edgePrompt: "resume prompt placeholder",
      startedAtMs: completedAtMs + 1,
      completedAtMs: completedAtMs + 2,
      cwd: tmpDir,
      assembledPrompt: null,
    }),
    detailHash,
    role: "worker",
    frontmatter,
    body: "",
    startedAtMs: completedAtMs + 1,
    completedAtMs: completedAtMs + 2,
  });

  await writeFile(
    mockAgentPath,
    `#!/bin/sh
prompt=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--prompt" ]; then
    prompt="$2"
    shift 2
  else
    shift
  fi
done
printf '%s' "$prompt" > '${promptCapturePath}'
echo '${adapterJson}'
`,
    { mode: 0o755 },
  );

  const configPath = join(tmpDir, "config.yaml");
  await writeFile(
    configPath,
    `defaultAgent: uwf-hermes\nagentOverrides: null\nagents:\n  uwf-hermes:\n    command: uwf-hermes\n`,
  );

  return { casDir, mockAgentPath, promptCapturePath };
}

function runUwf(
  args: string[],
  casDir: string,
): { stdout: string; stderr: string; status: number } {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli.js");
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
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

describe("uwf thread resume", () => {
  test("resume non-suspended thread returns error", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "idle-workflow",
      description: "idle thread",
      roles: {
        worker: {
          description: "Worker",
          goal: "Work",
          capabilities: [],
          procedure: "work",
          output: "result",
          frontmatter: await putSchema(store, OUTPUT_SCHEMA),
        },
      },
      graph: {
        $START: {
          new: { role: "worker", prompt: "Start", location: null },
          resume: { role: "worker", prompt: "Resume", location: null },
        },
        worker: { done: { role: "$END", prompt: "Done", location: null } },
      },
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "task",
      cwd: tmpDir,
    });

    process.env.OCAS_HOME = casDir;
    await seedThreads(tmpDir, { [THREAD_ID]: startHash });

    const result = runUwf(["thread", "resume", THREAD_ID], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("thread cannot be resumed");
  });

  test("resume suspended thread executes step and becomes idle", async () => {
    const originalCasDir = process.env.OCAS_HOME;
    const { casDir, mockAgentPath } = await setupSuspendedThread("ok");
    process.env.OCAS_HOME = casDir;

    try {
      const result = runUwf(["thread", "resume", THREAD_ID, "--agent", mockAgentPath], casDir);
      expect(result.status).toBe(0);

      const cliOutput = JSON.parse(result.stdout.trim());
      expect(cliOutput.status).toBe("idle");
      expect(cliOutput.currentRole).toBe("reviewer");
      expect(cliOutput.suspendedRole).toBeNull();
      expect(cliOutput.suspendMessage).toBeNull();
      expect(cliOutput.done).toBe(false);

      const { createUwfStore, getThread } = await import("../store.js");
      const uwf = await createUwfStore(tmpDir);
      const entry = getThread(uwf.varStore, THREAD_ID);
      expect(entry?.head).toBe(cliOutput.head);
      expect(entry?.suspendedRole).toBeNull();
      expect(entry?.suspendMessage).toBeNull();

      const showResult = await cmdThreadShow(tmpDir, THREAD_ID);
      expect(showResult.status).toBe("idle");
      expect(showResult.suspendedRole).toBeNull();
      expect(showResult.suspendMessage).toBeNull();
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_HOME;
      } else {
        process.env.OCAS_HOME = originalCasDir;
      }
    }
  });

  test("resume without -p uses suspend message as agent prompt", async () => {
    const originalCasDir = process.env.OCAS_HOME;
    const { casDir, mockAgentPath, promptCapturePath } = await setupSuspendedThread("ok");
    process.env.OCAS_HOME = casDir;

    try {
      const result = runUwf(["thread", "resume", THREAD_ID, "--agent", mockAgentPath], casDir);
      expect(result.status).toBe(0);

      const capturedPrompt = await readFile(promptCapturePath, "utf8");
      expect(capturedPrompt).toBe(SUSPEND_MESSAGE);
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_HOME;
      } else {
        process.env.OCAS_HOME = originalCasDir;
      }
    }
  });

  test("resume with -p appends supplementary info to agent prompt", async () => {
    const originalCasDir = process.env.OCAS_HOME;
    const { casDir, mockAgentPath, promptCapturePath } = await setupSuspendedThread("ok");
    process.env.OCAS_HOME = casDir;

    try {
      const supplement = "Use the REST API.";
      const result = runUwf(
        ["thread", "resume", THREAD_ID, "-p", supplement, "--agent", mockAgentPath],
        casDir,
      );
      expect(result.status).toBe(0);

      const capturedPrompt = await readFile(promptCapturePath, "utf8");
      expect(capturedPrompt).toBe(`${SUSPEND_MESSAGE}\n\n${supplement}`);
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_HOME;
      } else {
        process.env.OCAS_HOME = originalCasDir;
      }
    }
  });

  test("multiple suspend/resume cycles", async () => {
    const originalCasDir = process.env.OCAS_HOME;
    const { casDir, mockAgentPath, promptCapturePath } = await setupSuspendedThread("suspend");
    process.env.OCAS_HOME = casDir;

    try {
      const firstResult = runUwf(["thread", "resume", THREAD_ID, "--agent", mockAgentPath], casDir);
      expect(firstResult.status).toBe(0);
      const firstResume = JSON.parse(firstResult.stdout.trim());
      expect(firstResume.status).toBe("suspended");
      expect(firstResume.suspendedRole).toBe("worker");
      expect(firstResume.suspendMessage).toBe(SUSPEND_MESSAGE);

      const { createUwfStore, getThread } = await import("../store.js");
      const uwfAfterFirst = await createUwfStore(tmpDir);
      expect(getThread(uwfAfterFirst.varStore, THREAD_ID)).toEqual({
        head: firstResume.head,
        status: "suspended",
        suspendedRole: "worker",
        suspendMessage: SUSPEND_MESSAGE,
        completedAt: null,
      });

      const { mockAgentPath: okMockAgentPath } = await setupOkMockAgent(
        casDir,
        firstResume.head as CasRef,
      );

      const secondResult = runUwf(
        ["thread", "resume", THREAD_ID, "--agent", okMockAgentPath],
        casDir,
      );
      expect(secondResult.status).toBe(0);
      const secondResume = JSON.parse(secondResult.stdout.trim());
      expect(secondResume.status).toBe("idle");
      expect(secondResume.currentRole).toBe("reviewer");
      expect(secondResume.suspendedRole).toBeNull();
      expect(secondResume.suspendMessage).toBeNull();

      const capturedPrompt = await readFile(promptCapturePath, "utf8");
      expect(capturedPrompt).toBe(SUSPEND_MESSAGE);
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_HOME;
      } else {
        process.env.OCAS_HOME = originalCasDir;
      }
    }
  });
});

async function setupOkMockAgent(
  casDir: string,
  prevHead: CasRef,
): Promise<{ mockAgentPath: string }> {
  const store = await openStore(casDir);
  const schemas = await registerUwfSchemas(store);
  const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

  const prevNode = store.cas.get(prevHead);
  if (prevNode === null || prevNode.type !== schemas.stepNode) {
    throw new Error(`expected StepNode at ${prevHead}`);
  }
  const prevPayload = prevNode.payload as StepNodePayload;

  const outputHash = await store.cas.put(outputSchemaHash, { $status: "ok" });
  const detailHash = await store.cas.put(schemas.text, "ok detail");
  const startedAtMs = Date.now();
  const completedAtMs = startedAtMs + 1;

  const stepHash = await store.cas.put(schemas.stepNode, {
    start: prevPayload.start,
    prev: prevHead,
    role: "worker",
    output: outputHash,
    detail: detailHash,
    agent: "uwf-mock",
    edgePrompt: "resume",
    startedAtMs,
    completedAtMs,
    cwd: tmpDir,
    assembledPrompt: null,
  });

  const promptCapturePath = join(tmpDir, "captured-prompt.txt");
  const mockAgentPath = join(tmpDir, "mock-agent-ok.sh");
  const adapterJson = JSON.stringify({
    stepHash,
    detailHash,
    role: "worker",
    frontmatter: { $status: "ok" },
    body: "",
    startedAtMs,
    completedAtMs,
  });

  await writeFile(
    mockAgentPath,
    `#!/bin/sh
prompt=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--prompt" ]; then
    prompt="$2"
    shift 2
  else
    shift
  fi
done
printf '%s' "$prompt" > '${promptCapturePath}'
echo '${adapterJson}'
`,
    { mode: 0o755 },
  );

  return { mockAgentPath };
}

describe("uwf thread resume - completed threads", () => {
  test("resume completed thread starts from $START role", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-completed-resume",
      description: "completed thread resume test",
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
          resume: { role: "worker", prompt: "Resume the work", location: null },
        },
        worker: { done: { role: "reviewer", prompt: "Review the work", location: null } },
        reviewer: { done: { role: "$END", prompt: "Done", location: null } },
      },
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Initial task",
      cwd: tmpDir,
    });

    process.env.OCAS_HOME = casDir;

    const workerOutputHash = await store.cas.put(outputSchemaHash, { $status: "done" });
    const reviewerOutputHash = await store.cas.put(outputSchemaHash, { $status: "done" });
    const detailHash = await store.cas.put(schemas.text, "mock detail");

    const workerStepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: workerOutputHash,
      detail: detailHash,
      agent: "uwf-mock",
      edgePrompt: "Start work",
      startedAtMs: 1716600000000,
      completedAtMs: 1716600001000,
      cwd: tmpDir,
      assembledPrompt: null,
    });

    const reviewerStepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: workerStepHash,
      role: "reviewer",
      output: reviewerOutputHash,
      detail: detailHash,
      agent: "uwf-mock",
      edgePrompt: "Review the work",
      startedAtMs: 1716600001000,
      completedAtMs: 1716600002000,
      cwd: tmpDir,
      assembledPrompt: null,
    });

    await seedThreads(tmpDir, {
      [THREAD_ID]: {
        head: reviewerStepHash,
        status: "completed",
        suspendedRole: null,
        suspendMessage: null,
        completedAt: 1716600002000,
      },
    });

    // Verify the status was actually set
    const { createUwfStore, getThread } = await import("../store.js");
    const verifyUwf = await createUwfStore(tmpDir);
    const verifyEntry = getThread(verifyUwf.varStore, THREAD_ID);
    console.log("Seeded entry status:", verifyEntry?.status);
    console.log("Seeded entry:", JSON.stringify(verifyEntry, null, 2));

    const promptCapturePath = join(tmpDir, "captured-prompt-completed.txt");
    const mockAgentPath = join(tmpDir, "mock-agent-completed.sh");

    const newWorkerStepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: reviewerStepHash,
      role: "worker",
      output: workerOutputHash,
      detail: detailHash,
      agent: "uwf-mock",
      edgePrompt: "Start work",
      startedAtMs: 1716600003000,
      completedAtMs: 1716600004000,
      cwd: tmpDir,
      assembledPrompt: null,
    });

    const adapterJson = JSON.stringify({
      stepHash: newWorkerStepHash,
      detailHash,
      role: "worker",
      frontmatter: { $status: "done" },
      body: "",
      startedAtMs: 1716600003000,
      completedAtMs: 1716600004000,
    });

    await writeFile(
      mockAgentPath,
      `#!/bin/sh
prompt=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--prompt" ]; then
    prompt="$2"
    shift 2
  else
    shift
  fi
done
printf '%s' "$prompt" > '${promptCapturePath}'
echo '${adapterJson}'
`,
      { mode: 0o755 },
    );

    const configPath = join(tmpDir, "config.yaml");
    await writeFile(
      configPath,
      `defaultAgent: uwf-hermes\nagentOverrides: null\nagents:\n  uwf-hermes:\n    command: uwf-hermes\n`,
    );

    const result = runUwf(
      ["thread", "resume", THREAD_ID, "-p", "Additional context", "--agent", mockAgentPath],
      casDir,
    );

    if (result.status !== 0) {
      console.error("Command failed:", result.stderr);
    }

    expect(result.status).toBe(0);

    const cliOutput = JSON.parse(result.stdout.trim());
    expect(cliOutput.status).toBe("idle");
    expect(cliOutput.currentRole).toBe("reviewer");
    expect(cliOutput.done).toBe(false);

    const capturedPrompt = await readFile(promptCapturePath, "utf8");
    expect(capturedPrompt).toContain("Resume the work");
    expect(capturedPrompt).toContain("Additional context");

    const storeModule = await import("../store.js");
    const uwf2 = await storeModule.createUwfStore(tmpDir);
    const entry2 = storeModule.getThread(uwf2.varStore, THREAD_ID);
    expect(entry2?.status).toBe("idle");
    expect(entry2?.completedAt).toBeNull();
  });

  test("resume cancelled thread returns error", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "cancelled-workflow",
      description: "cancelled thread",
      roles: {
        worker: {
          description: "Worker",
          goal: "Work",
          capabilities: [],
          procedure: "work",
          output: "result",
          frontmatter: await putSchema(store, OUTPUT_SCHEMA),
        },
      },
      graph: {
        $START: {
          new: { role: "worker", prompt: "Start", location: null },
          resume: { role: "worker", prompt: "Resume", location: null },
        },
        worker: { done: { role: "$END", prompt: "Done", location: null } },
      },
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "task",
      cwd: tmpDir,
    });

    process.env.OCAS_HOME = casDir;
    await seedThreads(tmpDir, {
      [THREAD_ID]: {
        head: startHash,
        status: "cancelled",
        suspendedRole: null,
        suspendMessage: null,
        completedAt: null,
      },
    });

    const result = runUwf(["thread", "resume", THREAD_ID], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("thread cannot be resumed");
    expect(result.stderr).toContain("cancelled");
  });

  test("resume idle thread returns error", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "idle-workflow",
      description: "idle thread",
      roles: {
        worker: {
          description: "Worker",
          goal: "Work",
          capabilities: [],
          procedure: "work",
          output: "result",
          frontmatter: await putSchema(store, OUTPUT_SCHEMA),
        },
      },
      graph: {
        $START: {
          new: { role: "worker", prompt: "Start", location: null },
          resume: { role: "worker", prompt: "Resume", location: null },
        },
        worker: { done: { role: "$END", prompt: "Done", location: null } },
      },
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "task",
      cwd: tmpDir,
    });

    process.env.OCAS_HOME = casDir;
    await seedThreads(tmpDir, { [THREAD_ID]: startHash });

    const result = runUwf(["thread", "resume", THREAD_ID], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("thread cannot be resumed");
    expect(result.stderr).toContain("idle");
  });
});
