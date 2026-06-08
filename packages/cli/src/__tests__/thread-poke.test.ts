import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type {
  CasRef,
  StepNodePayload,
  ThreadId,
  ThreadIndexEntry,
} from "@united-workforce/protocol";
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

const THREAD_ID = "01POKESTEPTEST00000000" as ThreadId;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-poke-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

type SetupResult = {
  casDir: string;
  oldStepHash: CasRef;
  oldStepPrev: CasRef | null;
  oldStepCompletedAtMs: number;
  startHash: CasRef;
  workflowHash: CasRef;
  mockAgentPath: string;
  failingAgentPath: string;
  promptCapturePath: string;
  envCapturePath: string;
};

type SetupOpts = {
  threadStatus: ThreadIndexEntry["status"];
  multipleSteps: boolean;
  newCompletedAtMs: number;
  newStatus: string;
  // The agent name to record in the head StepNode.agent field. Defaults to mockAgentPath.
  stepAgentNameOverride: string | null;
  // Whether to seed an actual head StepNode (false → only StartNode is the head).
  withHeadStep: boolean;
};

async function setupThread(opts: Partial<SetupOpts> = {}): Promise<SetupResult> {
  const cfg: SetupOpts = {
    threadStatus: opts.threadStatus ?? "idle",
    multipleSteps: opts.multipleSteps ?? false,
    newCompletedAtMs: opts.newCompletedAtMs ?? 1716600005000,
    newStatus: opts.newStatus ?? "ok",
    stepAgentNameOverride: opts.stepAgentNameOverride ?? null,
    withHeadStep: opts.withHeadStep ?? true,
  };

  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });

  const store = await openStore(casDir);
  const schemas = await registerUwfSchemas(store);
  const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

  const workflowHash = await store.cas.put(schemas.workflow, {
    name: "test-poke",
    description: "poke command integration test",
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
        needs_input: {
          role: "$SUSPEND",
          prompt: "Please clarify",
          location: null,
        },
      },
      reviewer: { done: { role: "$END", prompt: "Done", location: null } },
    },
  });

  const startHash = await store.cas.put(schemas.startNode, {
    workflow: workflowHash,
    prompt: "Test poke task",
    cwd: tmpDir,
  });

  process.env.OCAS_HOME = casDir;

  // Paths for mock agent and capture files (set early so we can use mockAgentPath as the recorded agent name)
  const promptCapturePath = join(tmpDir, "captured-prompt.txt");
  const envCapturePath = join(tmpDir, "captured-env.txt");
  const mockAgentPath = join(tmpDir, "mock-agent.sh");
  const failingAgentPath = join(tmpDir, "failing-agent.sh");

  // Build head StepNode chain
  let oldStepPrev: CasRef | null = null;
  if (cfg.multipleSteps) {
    // First step: prev=null
    const firstOutputHash = await store.cas.put(outputSchemaHash, { $status: "ok" });
    const firstDetailHash = await store.cas.put(schemas.text, "first detail");
    const firstStepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: firstOutputHash,
      detail: firstDetailHash,
      agent: cfg.stepAgentNameOverride ?? mockAgentPath,
      edgePrompt: "Start work",
      startedAtMs: 1716600000000,
      completedAtMs: 1716600001000,
      cwd: tmpDir,
      assembledPrompt: null,
      usage: null,
    });
    oldStepPrev = firstStepHash;
  }

  let oldStepHash: CasRef = startHash;
  const oldStepCompletedAtMs = 1716600002000;
  if (cfg.withHeadStep) {
    const outputHash = await store.cas.put(outputSchemaHash, { $status: "ok" });
    const detailHash = await store.cas.put(schemas.text, "head step detail");
    oldStepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: oldStepPrev,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: cfg.stepAgentNameOverride ?? mockAgentPath,
      edgePrompt: "Start work",
      startedAtMs: 1716600001500,
      completedAtMs: oldStepCompletedAtMs,
      cwd: tmpDir,
      assembledPrompt: null,
      usage: null,
    });
  }

  // Seed thread index entry. For "running" we let the test create the marker separately.
  await seedThreads(tmpDir, {
    [THREAD_ID]: {
      head: oldStepHash,
      status: cfg.threadStatus,
      suspendedRole: cfg.threadStatus === "suspended" ? "worker" : null,
      suspendMessage: cfg.threadStatus === "suspended" ? "Please clarify" : null,
      completedAt:
        cfg.threadStatus === "completed" || cfg.threadStatus === "cancelled"
          ? oldStepCompletedAtMs
          : null,
    },
  });

  // Mock agent always emits a stepNode keyed off the current thread head (which we
  // observe through OCAS_HOME). The script writes prompt/env captures and then prints
  // an adapter JSON that references a pre-built stepHash.
  // We pre-build the agent's stepHash with prev=oldStepHash (normal append behaviour).
  const newOutputHash = await store.cas.put(outputSchemaHash, {
    $status: cfg.newStatus,
    note: "poked output",
  });
  const newDetailHash = await store.cas.put(schemas.text, "poked detail");
  const agentStepHash = await store.cas.put(schemas.stepNode, {
    start: startHash,
    prev: cfg.withHeadStep ? oldStepHash : null,
    role: "worker",
    output: newOutputHash,
    detail: newDetailHash,
    agent: "mock-agent-output",
    edgePrompt: "poke prompt placeholder",
    startedAtMs: cfg.newCompletedAtMs - 100,
    completedAtMs: cfg.newCompletedAtMs,
    cwd: tmpDir,
    assembledPrompt: null,
    usage: null,
  });

  const adapterJson = JSON.stringify({
    stepHash: agentStepHash,
    detailHash: newDetailHash,
    role: "worker",
    frontmatter: { $status: cfg.newStatus, note: "poked output" },
    body: "",
    startedAtMs: cfg.newCompletedAtMs - 100,
    completedAtMs: cfg.newCompletedAtMs,
    usage: null,
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
printf 'OCAS_HOME=%s\\n' "$OCAS_HOME" > '${envCapturePath}'
echo '${adapterJson}'
`,
    { mode: 0o755 },
  );

  await writeFile(
    failingAgentPath,
    `#!/bin/sh
echo "boom" >&2
exit 7
`,
    { mode: 0o755 },
  );

  const configPath = join(tmpDir, "config.yaml");
  await writeFile(configPath, `defaultAgent: uwf-hermes\nagentOverrides: null\nagents: {}\n`);

  return {
    casDir,
    oldStepHash,
    oldStepPrev,
    oldStepCompletedAtMs,
    startHash,
    workflowHash,
    mockAgentPath,
    failingAgentPath,
    promptCapturePath,
    envCapturePath,
  };
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

// ── Group 1: CLI argument validation ───────────────────────────────────────

describe("uwf thread poke - CLI argument validation", () => {
  test("1.1 missing -p flag exits non-zero", async () => {
    const { casDir } = await setupThread();
    const result = runUwf(["thread", "poke", THREAD_ID], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/required|missing|prompt/);
  });

  test("1.2 -p without --agent succeeds", async () => {
    const { casDir } = await setupThread();
    const result = runUwf(["thread", "poke", THREAD_ID, "-p", "do it again"], casDir);
    expect(result.status).toBe(0);
  });

  test("1.3 -p with --agent succeeds", async () => {
    const { casDir, mockAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "do it again", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
  });
});

// ── Group 2: Guard errors ──────────────────────────────────────────────────

describe("uwf thread poke - guard errors", () => {
  test("2.1 thread not found", async () => {
    const { casDir } = await setupThread();
    const result = runUwf(["thread", "poke", "01NOSUCHTHREAD0000000A", "-p", "prompt"], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/not found|not active/);
  });

  test("2.2 thread running rejects poke", async () => {
    const { casDir, workflowHash } = await setupThread();
    // Create background marker to simulate running
    const { createMarker } = await import("../background/index.js");
    await createMarker(tmpDir, {
      thread: THREAD_ID,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
    });

    const result = runUwf(["thread", "poke", THREAD_ID, "-p", "prompt"], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("already executing");
  });

  test("2.3 completed thread rejects poke", async () => {
    const { casDir } = await setupThread({ threadStatus: "completed" });
    const result = runUwf(["thread", "poke", THREAD_ID, "-p", "prompt"], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/cannot be poked|completed/);
  });

  test("2.4 cancelled thread rejects poke", async () => {
    const { casDir } = await setupThread({ threadStatus: "cancelled" });
    const result = runUwf(["thread", "poke", THREAD_ID, "-p", "prompt"], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/cannot be poked|cancelled/);
  });

  test("2.5 thread head is StartNode (no StepNode) rejects poke", async () => {
    const { casDir } = await setupThread({ withHeadStep: false });
    const result = runUwf(["thread", "poke", THREAD_ID, "-p", "prompt"], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/no step|cannot be poked/);
  });
});

// ── Group 3: Success happy path ────────────────────────────────────────────

describe("uwf thread poke - success", () => {
  test("3.1, 3.4 idle thread → new head differs from old, thread index updated", async () => {
    const { casDir, oldStepHash, mockAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());
    expect(cliOutput.head).not.toBe(oldStepHash);

    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.head).toBe(cliOutput.head);
  });

  test("3.2 new step's prev equals old head's prev (replace, not append)", async () => {
    const { casDir, oldStepPrev, mockAgentPath } = await setupThread({ multipleSteps: true });
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());

    const { createUwfStore } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const node = uwf.store.cas.get(cliOutput.head as CasRef);
    expect(node).not.toBeNull();
    expect(node?.type).toBe(uwf.schemas.stepNode);
    const payload = node?.payload as StepNodePayload;
    expect(payload.prev).toBe(oldStepPrev);
  });

  test("3.2b new step's prev is null when old head was the first step", async () => {
    // multipleSteps:false means oldHead.prev = null
    const { casDir, mockAgentPath } = await setupThread({ multipleSteps: false });
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());

    const { createUwfStore } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const node = uwf.store.cas.get(cliOutput.head as CasRef);
    const payload = node?.payload as StepNodePayload;
    expect(payload.prev).toBeNull();
  });

  test("3.3 new step's completedAtMs is later than old", async () => {
    const { casDir, oldStepCompletedAtMs, mockAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());

    const { createUwfStore } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const node = uwf.store.cas.get(cliOutput.head as CasRef);
    const payload = node?.payload as StepNodePayload;
    expect(payload.completedAtMs).toBeGreaterThan(oldStepCompletedAtMs);
  });

  test("3.5 status remains idle after poke (no completion/suspend)", async () => {
    const { casDir, mockAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());
    expect(cliOutput.status).toBe("idle");
    expect(cliOutput.done).toBe(false);
    expect(cliOutput.suspendedRole).toBeNull();
    expect(cliOutput.suspendMessage).toBeNull();
  });

  test("3.6 currentRole unchanged after poke (no moderator re-route)", async () => {
    // Before poke: idle thread with worker step having $status=ok → moderator would route to reviewer.
    // After poke (mock returns same $status=ok), moderator routing remains the same.
    const { casDir, mockAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());
    expect(cliOutput.currentRole).toBe("reviewer");
  });
});

// ── Group 4: Agent resolution ──────────────────────────────────────────────

describe("uwf thread poke - agent resolution", () => {
  test("4.1 without --agent, agent command read from head step's agent field", async () => {
    // Head step's agent field points at mockAgentPath (default in setupThread)
    const { casDir, promptCapturePath } = await setupThread();
    const result = runUwf(["thread", "poke", THREAD_ID, "-p", "redo"], casDir);
    expect(result.status).toBe(0);
    const captured = await readFile(promptCapturePath, "utf8");
    expect(captured).toBe("redo");
  });

  test("4.2 with --agent, explicit override is used", async () => {
    // Head step records "uwf-mock" (which is not a real binary). Override with mockAgentPath.
    const { casDir, mockAgentPath } = await setupThread({ stepAgentNameOverride: "uwf-mock" });
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
  });
});

// ── Group 5: Prompt passthrough ────────────────────────────────────────────

describe("uwf thread poke - prompt passthrough", () => {
  test("5.1 -p value is passed to agent as --prompt", async () => {
    const { casDir, mockAgentPath, promptCapturePath } = await setupThread();
    const supplement = "Use the REST API instead.";
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", supplement, "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const captured = await readFile(promptCapturePath, "utf8");
    expect(captured).toBe(supplement);
  });
});

// ── Group 6: Edge cases ────────────────────────────────────────────────────

describe("uwf thread poke - edge cases", () => {
  test("6.1 poke succeeds on suspended thread", async () => {
    const { casDir, oldStepHash, mockAgentPath } = await setupThread({
      threadStatus: "suspended",
    });
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    const cliOutput = JSON.parse(result.stdout.trim());
    expect(cliOutput.head).not.toBe(oldStepHash);
    expect(cliOutput.status).toBe("idle");
    expect(cliOutput.suspendedRole).toBeNull();
    expect(cliOutput.suspendMessage).toBeNull();
  });

  test("6.2 agent failure leaves thread head unchanged", async () => {
    const { casDir, oldStepHash, failingAgentPath } = await setupThread();
    const result = runUwf(
      ["thread", "poke", THREAD_ID, "-p", "redo", "--agent", failingAgentPath],
      casDir,
    );
    expect(result.status).not.toBe(0);

    const { createUwfStore, getThread } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const entry = getThread(uwf.varStore, THREAD_ID);
    expect(entry?.head).toBe(oldStepHash);
  });
});
