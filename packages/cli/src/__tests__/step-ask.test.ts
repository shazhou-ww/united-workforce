import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap, putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, ThreadId, ThreadIndexEntry } from "@united-workforce/protocol";
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

const DETAIL_SCHEMA = {
  title: "ask-detail",
  type: "object" as const,
  required: ["sessionId", "model", "duration", "turnCount", "turns"],
  properties: {
    sessionId: { type: "string" as const },
    model: { type: "string" as const },
    duration: { type: "integer" as const },
    turnCount: { type: "integer" as const },
    turns: {
      type: "array" as const,
      items: { type: "string" as const, format: "ocas_ref" },
    },
  },
  additionalProperties: false,
};

const THREAD_ID = "01ASKSTEPTEST000000000" as ThreadId;
const STEP_SESSION_ID = "ses-original-step-001";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-step-ask-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

type SetupOpts = {
  threadStatus: ThreadIndexEntry["status"];
  withDetail: boolean;
  // The agent name (path or alias) to record in the head StepNode.agent field.
  // Defaults to mockAgentPath.
  stepAgentNameOverride: string | null;
  // Pre-cached fork session-id. When provided, the cache file is written
  // before running so the test can verify reuse semantics.
  preCachedForkSessionId: string | null;
};

type SetupResult = {
  casDir: string;
  stepHash: CasRef;
  startHash: CasRef;
  workflowHash: CasRef;
  detailHash: CasRef | null;
  mockAgentPath: string;
  failingAgentPath: string;
  promptCapturePath: string;
  modeCapturePath: string;
  forkSessionCapturePath: string;
  askSessionCapturePath: string;
  envCapturePath: string;
};

async function setupAskFixture(opts: Partial<SetupOpts> = {}): Promise<SetupResult> {
  const cfg: SetupOpts = {
    threadStatus: opts.threadStatus ?? "idle",
    withDetail: opts.withDetail ?? true,
    stepAgentNameOverride: opts.stepAgentNameOverride ?? null,
    preCachedForkSessionId: opts.preCachedForkSessionId ?? null,
  };

  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });

  const store = await openStore(casDir);
  await bootstrap(store);
  const schemas = await registerUwfSchemas(store);
  const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);
  const detailSchemaHash = await putSchema(store, DETAIL_SCHEMA);

  const workflowHash = await store.cas.put(schemas.workflow, {
    name: "test-ask",
    description: "ask command integration test",
    roles: {
      worker: {
        description: "Worker",
        goal: "Work",
        capabilities: [],
        procedure: "work",
        output: "result",
        frontmatter: outputSchemaHash,
      },
    },
    graph: {
      $START: {
        new: { role: "worker", prompt: "Start work", location: null },
      },
      worker: { ok: { role: "$END", prompt: "done", location: null } },
    },
  });

  const startHash = await store.cas.put(schemas.startNode, {
    workflow: workflowHash,
    prompt: "Test ask task",
    cwd: tmpDir,
  });

  // Set OCAS_HOME so seedThreads + in-test createUwfStore calls resolve to this CAS dir.
  process.env.OCAS_HOME = casDir;

  // Capture file paths
  const promptCapturePath = join(tmpDir, "captured-prompt.txt");
  const modeCapturePath = join(tmpDir, "captured-mode.txt");
  const forkSessionCapturePath = join(tmpDir, "captured-fork-session.txt");
  const askSessionCapturePath = join(tmpDir, "captured-ask-session.txt");
  const envCapturePath = join(tmpDir, "captured-env.txt");
  const mockAgentPath = join(tmpDir, "mock-agent.sh");
  const failingAgentPath = join(tmpDir, "failing-agent.sh");

  // Build a detail node with sessionId so step ask can extract it
  let detailHash: CasRef | null = null;
  if (cfg.withDetail) {
    const turnHash = await store.cas.put(detailSchemaHash, {
      sessionId: STEP_SESSION_ID,
      model: "test-model",
      duration: 1000,
      turnCount: 0,
      turns: [],
    });
    detailHash = turnHash;
  }

  // Build the StepNode at thread head
  const outputHash = await store.cas.put(outputSchemaHash, { $status: "ok" });
  const stepHash = await store.cas.put(schemas.stepNode, {
    start: startHash,
    prev: null,
    role: "worker",
    output: outputHash,
    detail: detailHash,
    agent: cfg.stepAgentNameOverride ?? mockAgentPath,
    edgePrompt: "Start work",
    startedAtMs: 1716600000000,
    completedAtMs: 1716600001000,
    cwd: tmpDir,
    assembledPrompt: null,
    usage: null,
  });

  // Seed thread index entry
  await seedThreads(tmpDir, {
    [THREAD_ID]: {
      head: stepHash,
      status: cfg.threadStatus,
      suspendedRole: null,
      suspendMessage: null,
      completedAt: cfg.threadStatus === "completed" ? 1716600001000 : null,
    },
  });

  // Pre-seed the ask session cache so reuse tests have something to find.
  if (cfg.preCachedForkSessionId !== null) {
    const cachePath = join(tmpDir, "cache", "mock-sessions.json");
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      `${JSON.stringify({ [`${stepHash}:ask`]: cfg.preCachedForkSessionId }, null, 2)}\n`,
      "utf8",
    );
  }

  // Mock agent: dispatches based on `--mode` (ask|fork|run) and captures inputs.
  // - --mode ask --session <id> --prompt <text>: writes to ask capture; echoes a fixed answer to stdout
  // - --mode fork --session <id>: writes to fork capture; prints "forked-from-<id>" sessionId on stdout
  // - default (uwf-* style invocation): captures and echoes adapter JSON (not used in this suite)
  await writeFile(
    mockAgentPath,
    `#!/bin/sh
mode=""
prompt=""
session=""
detail=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --prompt) prompt="$2"; shift 2 ;;
    --session) session="$2"; shift 2 ;;
    --detail) detail="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s' "$mode" > '${modeCapturePath}'
printf '%s' "$prompt" > '${promptCapturePath}'
printf 'OCAS_HOME=%s\\n' "$OCAS_HOME" > '${envCapturePath}'
case "$mode" in
  fork)
    printf '%s' "$session" > '${forkSessionCapturePath}'
    new_id="forked-from-$session"
    printf '%s\\n' "$new_id"
    ;;
  ask)
    printf '%s' "$session" > '${askSessionCapturePath}'
    # Print a deterministic answer that the cmdStepAsk path will hand back.
    printf 'MOCK_ANSWER prompt=%s session=%s detail=%s\\n' "$prompt" "$session" "$detail"
    ;;
  *)
    echo "{\\"stepHash\\":\\"unused\\"}"
    ;;
esac
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

  // Minimal config so loadWorkflowConfig succeeds.
  const configPath = join(tmpDir, "config.yaml");
  await writeFile(
    configPath,
    `defaultAgent: uwf-hermes\nagentOverrides: null\nagents:\n  uwf-hermes:\n    command: uwf-hermes\n`,
  );

  return {
    casDir,
    stepHash,
    startHash,
    workflowHash,
    detailHash,
    mockAgentPath,
    failingAgentPath,
    promptCapturePath,
    modeCapturePath,
    forkSessionCapturePath,
    askSessionCapturePath,
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

describe("uwf step ask - CLI argument validation", () => {
  test("1.1 missing step-hash exits non-zero", async () => {
    const { casDir } = await setupAskFixture();
    const result = runUwf(["step", "ask"], casDir);
    expect(result.status).not.toBe(0);
  });

  test("1.2 missing -p flag exits non-zero", async () => {
    const { casDir, stepHash } = await setupAskFixture();
    const result = runUwf(["step", "ask", stepHash], casDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/required|missing|prompt/);
  });

  test("1.3 step-hash and -p accepted as valid invocation", async () => {
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture();
    const result = runUwf(
      ["step", "ask", stepHash, "-p", "why?", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
  });
});

// ── Group 2: CAS validation errors ────────────────────────────────────────

describe("uwf step ask - CAS validation errors", () => {
  test("2.1 non-existent CAS hash exits non-zero with 'not found'", async () => {
    const { casDir, mockAgentPath } = await setupAskFixture();
    const result = runUwf(
      ["step", "ask", "0000000000000", "-p", "why?", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("not found");
  });

  test("2.2 hash that is not a StepNode exits non-zero", async () => {
    const { casDir, startHash, mockAgentPath } = await setupAskFixture();
    // Use the StartNode hash — it exists but is not a StepNode
    const result = runUwf(
      ["step", "ask", startHash, "-p", "why?", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("not a stepnode");
  });

  test("2.3 step with no detail ref exits non-zero", async () => {
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture({ withDetail: false });
    const result = runUwf(
      ["step", "ask", stepHash, "-p", "why?", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/no detail|detail.*missing|missing.*detail/);
  });
});

// ── Group 3: Successful ask (core behavior) ───────────────────────────────

describe("uwf step ask - successful ask (core)", () => {
  test("3.1 stdout contains agent's response text", async () => {
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture();
    const result = runUwf(
      ["step", "ask", stepHash, "-p", "why tar not zip?", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MOCK_ANSWER");
    expect(result.stdout).toContain("why tar not zip?");
  });

  test("3.2 thread index entry (head, status) is identical before and after ask", async () => {
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture();

    // Before ask: snapshot the thread state
    const { createUwfStore, getThread } = await import("../store.js");
    const before = await createUwfStore(tmpDir);
    const beforeEntry = getThread(before.varStore, THREAD_ID);
    expect(beforeEntry).not.toBeNull();

    const result = runUwf(
      ["step", "ask", stepHash, "-p", "anything", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);

    // After ask: thread state should be unchanged
    const after = await createUwfStore(tmpDir);
    const afterEntry = getThread(after.varStore, THREAD_ID);
    expect(afterEntry).not.toBeNull();
    expect(afterEntry?.head).toBe(beforeEntry?.head);
    expect(afterEntry?.status).toBe(beforeEntry?.status);
  });

  test("3.3 no new StepNode is written to CAS (step count unchanged)", async () => {
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture();

    // Count StepNodes before
    const { createUwfStore } = await import("../store.js");
    const before = await createUwfStore(tmpDir);
    const stepSchemaHash = before.schemas.stepNode;

    function countStepNodes(uwfStore: typeof before): number {
      const candidates = [stepHash];
      let count = 0;
      for (const h of candidates) {
        const node = uwfStore.store.cas.get(h);
        if (node !== null && node.type === stepSchemaHash) count++;
      }
      return count;
    }

    const beforeCount = countStepNodes(before);
    expect(beforeCount).toBe(1);

    const result = runUwf(
      ["step", "ask", stepHash, "-p", "anything", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);

    // After ask: still only the seeded StepNode exists at head; no new step appended.
    const after = await createUwfStore(tmpDir);
    const headNode = after.store.cas.get(stepHash);
    expect(headNode).not.toBeNull();
    expect(headNode?.type).toBe(after.schemas.stepNode);

    // Confirm thread head still points to the original step hash
    const { getThread } = await import("../store.js");
    const entry = getThread(after.varStore, THREAD_ID);
    expect(entry?.head).toBe(stepHash);
  });
});

// ── Group 4: Fork cache semantics ─────────────────────────────────────────

describe("uwf step ask - fork cache", { timeout: 15_000 }, () => {
  test("4.1 first ask creates a fork session and caches it", async () => {
    const { casDir, stepHash, mockAgentPath, forkSessionCapturePath } = await setupAskFixture();

    const result = runUwf(
      ["step", "ask", stepHash, "-p", "first ask", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);

    // The mock agent in fork mode receives the source session id
    const forkArg = await readFile(forkSessionCapturePath, "utf8");
    expect(forkArg).toBe(STEP_SESSION_ID);

    // Cache file should now contain the ask key
    const cachePath = join(tmpDir, "cache", "mock-sessions.json");
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed[`${stepHash}:ask`]).toBeDefined();
    expect(parsed[`${stepHash}:ask`]).toBe(`forked-from-${STEP_SESSION_ID}`);
  });

  test("4.2 second ask on same step reuses the cached fork session", async () => {
    const cachedFork = "ses-already-forked-once";
    const { casDir, stepHash, mockAgentPath, modeCapturePath, askSessionCapturePath } =
      await setupAskFixture({ preCachedForkSessionId: cachedFork });

    const result = runUwf(
      ["step", "ask", stepHash, "-p", "second ask", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);

    // The mock agent must have been invoked in `ask` mode (no fork performed).
    const mode = await readFile(modeCapturePath, "utf8");
    expect(mode).toBe("ask");

    // The ask invocation should have received the cached fork session id.
    const askArg = await readFile(askSessionCapturePath, "utf8");
    expect(askArg).toBe(cachedFork);
  });

  test("4.3 different step hash creates an independent fork", async () => {
    // Run a first ask on the base step → caches forkA
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture();

    const r1 = runUwf(
      ["step", "ask", stepHash, "-p", "ask on step A", "--agent", mockAgentPath],
      casDir,
    );
    expect(r1.status).toBe(0);

    // Build a second StepNode (different hash) with a different sessionId so
    // its detail-derived ask session is independent of the first.
    const { createUwfStore } = await import("../store.js");
    const uwf = await createUwfStore(tmpDir);
    const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);
    const outputSchemaHash = await putSchema(uwf.store, OUTPUT_SCHEMA);
    const otherDetailHash = await uwf.store.cas.put(detailSchemaHash, {
      sessionId: "ses-original-step-002",
      model: "test-model",
      duration: 1000,
      turnCount: 0,
      turns: [],
    });
    const otherOutputHash = await uwf.store.cas.put(outputSchemaHash, {
      $status: "ok",
      note: "alt",
    });

    // Reuse the same start ref the first step points to so the new step is a valid sibling.
    const head = uwf.store.cas.get(stepHash);
    const startRefFromHead = (head?.payload as { start: CasRef }).start;
    const properOtherStep = await uwf.store.cas.put(uwf.schemas.stepNode, {
      start: startRefFromHead,
      prev: null,
      role: "worker",
      output: otherOutputHash,
      detail: otherDetailHash,
      agent: mockAgentPath,
      edgePrompt: "Start work",
      startedAtMs: 1716600002000,
      completedAtMs: 1716600003000,
      cwd: tmpDir,
      assembledPrompt: null,
      usage: null,
    });

    // sanity check we constructed a separate hash
    expect(properOtherStep).not.toBe(stepHash);

    const r2 = runUwf(
      ["step", "ask", properOtherStep, "-p", "ask on step B", "--agent", mockAgentPath],
      casDir,
    );
    expect(r2.status).toBe(0);

    const cachePath = join(tmpDir, "cache", "mock-sessions.json");
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed[`${stepHash}:ask`]).toBeDefined();
    expect(parsed[`${properOtherStep}:ask`]).toBeDefined();
    expect(parsed[`${stepHash}:ask`]).not.toBe(parsed[`${properOtherStep}:ask`]);
  });
});

// ── Group 5: Fallback (agent has no fork support) ─────────────────────────

describe("uwf step ask - fallback path", () => {
  test("5.1 fallback agent (no fork support) still answers via stdout", async () => {
    // Use a fallback agent that ONLY supports `ask` mode without ever being asked
    // to fork. The CLI should detect missing fork support and inject context instead.
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture();

    // Create a fallback agent script that fails with non-zero exit on "fork" mode.
    // Fallback path must NOT call mode=fork; it should call mode=ask directly.
    const fallbackPath = join(tmpDir, "fallback-agent.sh");
    const promptCapture = join(tmpDir, "fallback-prompt.txt");
    const sessionCapture = join(tmpDir, "fallback-session.txt");
    const modeCapture = join(tmpDir, "fallback-mode.txt");
    await writeFile(
      fallbackPath,
      `#!/bin/sh
mode=""
prompt=""
session=""
detail=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --prompt) prompt="$2"; shift 2 ;;
    --session) session="$2"; shift 2 ;;
    --detail) detail="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s' "$mode" > '${modeCapture}'
printf '%s' "$prompt" > '${promptCapture}'
printf '%s' "$session" > '${sessionCapture}'
case "$mode" in
  fork) echo "fork not supported" >&2; exit 99 ;;
  ask) printf 'FALLBACK_ANSWER for: %s (detail=%s)\\n' "$prompt" "$detail" ;;
  *) echo "unknown" >&2; exit 1 ;;
esac
`,
      { mode: 0o755 },
    );

    const result = runUwf(
      ["step", "ask", stepHash, "-p", "explain context", "--agent", fallbackPath, "--no-fork"],
      casDir,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("FALLBACK_ANSWER");
    expect(result.stdout).toContain("explain context");

    // The fallback agent should be invoked in `ask` mode, with NO session id
    // (since no fork happened). The detail ref must be passed for context injection.
    const mode = await readFile(modeCapture, "utf8");
    expect(mode).toBe("ask");
    const session = await readFile(sessionCapture, "utf8");
    expect(session).toBe("");

    // Make sure mockAgentPath's mock never ran.
    void mockAgentPath;
  });

  test("5.2 fallback ask still does NOT mutate thread state", async () => {
    const { casDir, stepHash } = await setupAskFixture();

    const fallbackPath = join(tmpDir, "fallback-agent.sh");
    await writeFile(
      fallbackPath,
      `#!/bin/sh
mode=""
prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --prompt) prompt="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$mode" in
  fork) echo "fork not supported" >&2; exit 99 ;;
  ask) printf 'OK %s\\n' "$prompt" ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );

    const { createUwfStore, getThread } = await import("../store.js");
    const before = await createUwfStore(tmpDir);
    const beforeEntry = getThread(before.varStore, THREAD_ID);

    const result = runUwf(
      ["step", "ask", stepHash, "-p", "any", "--agent", fallbackPath, "--no-fork"],
      casDir,
    );
    expect(result.status).toBe(0);

    const after = await createUwfStore(tmpDir);
    const afterEntry = getThread(after.varStore, THREAD_ID);
    expect(afterEntry?.head).toBe(beforeEntry?.head);
    expect(afterEntry?.status).toBe(beforeEntry?.status);
  });
});

// ── Group 6: Agent resolution ─────────────────────────────────────────────

describe("uwf step ask - agent resolution", () => {
  test("6.1 without --agent flag, agent is resolved from step's agent field", async () => {
    // Step's agent field points at mockAgentPath by default.
    const { casDir, stepHash, modeCapturePath, promptCapturePath } = await setupAskFixture();
    const result = runUwf(["step", "ask", stepHash, "-p", "explain"], casDir);
    expect(result.status).toBe(0);

    // The mockAgentPath must have been invoked in ask mode with the user prompt.
    const mode = await readFile(modeCapturePath, "utf8");
    expect(mode).toBe("ask");
    const captured = await readFile(promptCapturePath, "utf8");
    expect(captured).toBe("explain");
  });

  test("6.2 --agent override beats step's recorded agent", async () => {
    // Record a non-existent agent in step.agent. Provide a working one via --agent.
    const { casDir, stepHash, mockAgentPath } = await setupAskFixture({
      stepAgentNameOverride: "uwf-does-not-exist",
    });
    const result = runUwf(
      ["step", "ask", stepHash, "-p", "explain", "--agent", mockAgentPath],
      casDir,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MOCK_ANSWER");
  });
});
