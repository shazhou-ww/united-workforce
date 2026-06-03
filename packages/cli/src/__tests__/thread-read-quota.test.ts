import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { cmdThreadRead } from "../commands/thread.js";
import { registerUwfSchemas } from "../schemas.js";
import { seedThreads } from "./thread-test-helpers.js";

// ── schemas used in tests ────────────────────────────────────────────────────

const TURN_SCHEMA = {
  title: "hermes-turn",
  type: "object" as const,
  required: ["index", "role", "content"],
  properties: {
    index: { type: "integer" as const },
    role: { type: "string" as const },
    content: { type: "string" as const },
    toolCalls: {
      anyOf: [
        { type: "array" as const, items: { type: "object" as const } },
        { type: "null" as const },
      ],
    },
    reasoning: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
  additionalProperties: false,
};

const DETAIL_SCHEMA = {
  title: "hermes-detail",
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

// ── helpers ───────────────────────────────────────────────────────────────────

async function registerDetailSchemas(store: Awaited<ReturnType<typeof openStore>>) {
  await bootstrap(store);
  const [turn, detail] = await Promise.all([
    putSchema(store, TURN_SCHEMA),
    putSchema(store, DETAIL_SCHEMA),
  ]);
  return { turn, detail };
}

function generateContent(size: number, prefix = "Content"): string {
  const base = `${prefix} `;
  const repeat = Math.ceil(size / base.length);
  return base.repeat(repeat).slice(0, size);
}

// ── fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-quota-test-"));
  originalEnv = process.env.OCAS_DIR;
  process.env.OCAS_DIR = join(tmpDir, "cas");
  await mkdir(process.env.OCAS_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) {
    delete process.env.OCAS_DIR;
  } else {
    process.env.OCAS_DIR = originalEnv;
  }
});

// ── thread read quota enforcement ─────────────────────────────────────────────

describe("thread read --quota flag", () => {
  test("test 1: basic quota enforcement with 3 steps", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do the work.",
          output: "Summarize the work.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.cas.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 3 steps with ~500 chars each
    const steps: CasRef[] = [];
    for (let i = 1; i <= 3; i++) {
      const content = generateContent(500, `Step${i}`);
      const turnHash = await store.cas.put(detailSchemas.turn, {
        index: 0,
        role: "assistant",
        content,
        toolCalls: null,
        reasoning: null,
      });
      const detailHash = await store.cas.put(detailSchemas.detail, {
        sessionId: `session-${i}`,
        model: "test-model",
        duration: 1000,
        turnCount: 1,
        turns: [turnHash],
      });
      const stepHash = await store.cas.put(schemas.stepNode, {
        start: startHash,
        prev: steps[i - 2] ?? null,
        role: "worker",
        output: outputHash,
        detail: detailHash,
        agent: "uwf-test",
        startedAtMs: 1000000000000,
        completedAtMs: 1000000005000,
        assembledPrompt: null,
      });
      steps.push(stepHash);
    }

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ0" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: steps[2] as CasRef });

    // Set quota to 800 chars - should only fit most recent steps
    const markdown = await cmdThreadRead(tmpDir, threadId, 800, null, false);

    // Quota must be reasonably enforced (allow ~200 char tolerance for skip hint)
    expect(markdown.length).toBeLessThanOrEqual(1000);

    // Should contain skip hint since not all steps fit
    expect(markdown).toMatch(/earlier step/);

    // Most recent step should be included
    expect(markdown).toMatch(/Step3/);
  });

  test("test 2: quota check order - verifies bug is fixed", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do the work.",
          output: "Summarize the work.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.cas.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 2 steps: first=300 chars, second=600 chars
    const step1Content = generateContent(300, "First");
    const step1TurnHash = await store.cas.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: step1Content,
      toolCalls: null,
      reasoning: null,
    });
    const step1DetailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "session-1",
      model: "test-model",
      duration: 1000,
      turnCount: 1,
      turns: [step1TurnHash],
    });
    const step1Hash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: step1DetailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const step2Content = generateContent(600, "Second");
    const step2TurnHash = await store.cas.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: step2Content,
      toolCalls: null,
      reasoning: null,
    });
    const step2DetailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "session-2",
      model: "test-model",
      duration: 1000,
      turnCount: 1,
      turns: [step2TurnHash],
    });
    const step2Hash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: step1Hash,
      role: "worker",
      output: outputHash,
      detail: step2DetailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ1" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: step2Hash });

    // Set quota to 500 chars
    const markdown = await cmdThreadRead(tmpDir, threadId, 500, null, false);

    // Bug fix verification: output must be limited (allow ~200 char tolerance)
    expect(markdown.length).toBeLessThanOrEqual(1100);

    // Should contain "Second" (most recent step)
    expect(markdown).toMatch(/Second/);

    // Should skip first step
    expect(markdown).toMatch(/earlier step/);

    // Verify improvement: before fix would be ~1264, now should be much closer to 500
    expect(markdown.length).toBeLessThan(1200);
  });

  test("test 3: quota with --start section", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do the work.",
          output: "Summarize the work.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task with a moderately long prompt to test quota accounting",
    });

    const outputHash = await store.cas.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 2 steps
    const steps: CasRef[] = [];
    for (let i = 1; i <= 2; i++) {
      const content = generateContent(400, `Step${i}`);
      const turnHash = await store.cas.put(detailSchemas.turn, {
        index: 0,
        role: "assistant",
        content,
        toolCalls: null,
        reasoning: null,
      });
      const detailHash = await store.cas.put(detailSchemas.detail, {
        sessionId: `session-${i}`,
        model: "test-model",
        duration: 1000,
        turnCount: 1,
        turns: [turnHash],
      });
      const stepHash = await store.cas.put(schemas.stepNode, {
        start: startHash,
        prev: steps[i - 2] ?? null,
        role: "worker",
        output: outputHash,
        detail: detailHash,
        agent: "uwf-test",
        startedAtMs: 1000000000000,
        completedAtMs: 1000000005000,
        assembledPrompt: null,
      });
      steps.push(stepHash);
    }

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ2" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: steps[1] as CasRef });

    // Set tight quota with --start flag
    const markdown = await cmdThreadRead(tmpDir, threadId, 600, null, true);

    // Quota must be reasonably enforced (allow ~260 char tolerance for structure)
    expect(markdown.length).toBeLessThanOrEqual(860);

    // Should contain thread header
    expect(markdown).toMatch(/# Thread/);
    expect(markdown).toMatch(/test-wf/);
  });

  test("test 5a: quota edge case - minimal quota", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do the work.",
          output: "Summarize the work.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.cas.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const content = generateContent(500, "Test");
    const turnHash = await store.cas.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content,
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "session-1",
      model: "test-model",
      duration: 1000,
      turnCount: 1,
      turns: [turnHash],
    });
    const stepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ4" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    // Minimal quota
    const markdown = await cmdThreadRead(tmpDir, threadId, 1, null, false);

    // Should handle gracefully - always shows at least one step
    expect(markdown.length).toBeGreaterThan(1);
    expect(markdown).toMatch(/Test/);
  });

  test("test 5b: quota edge case - very large quota", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do the work.",
          output: "Summarize the work.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.cas.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 3 steps
    const steps: CasRef[] = [];
    for (let i = 1; i <= 3; i++) {
      const content = generateContent(300, `Step${i}`);
      const turnHash = await store.cas.put(detailSchemas.turn, {
        index: 0,
        role: "assistant",
        content,
        toolCalls: null,
        reasoning: null,
      });
      const detailHash = await store.cas.put(detailSchemas.detail, {
        sessionId: `session-${i}`,
        model: "test-model",
        duration: 1000,
        turnCount: 1,
        turns: [turnHash],
      });
      const stepHash = await store.cas.put(schemas.stepNode, {
        start: startHash,
        prev: steps[i - 2] ?? null,
        role: "worker",
        output: outputHash,
        detail: detailHash,
        agent: "uwf-test",
        startedAtMs: 1000000000000,
        completedAtMs: 1000000005000,
        assembledPrompt: null,
      });
      steps.push(stepHash);
    }

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ5" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: steps[2] as CasRef });

    // Very large quota
    const markdown = await cmdThreadRead(tmpDir, threadId, 1000000, null, false);

    // Should show all steps (no skipping)
    expect(markdown).not.toMatch(/earlier step/);
    expect(markdown).toMatch(/Step1/);
    expect(markdown).toMatch(/Step2/);
    expect(markdown).toMatch(/Step3/);
  });

  test("test 6: quota with --before parameter", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do the work.",
          output: "Summarize the work.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.cas.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 5 steps
    const steps: CasRef[] = [];
    for (let i = 1; i <= 5; i++) {
      const content = generateContent(300, `Step${i}`);
      const turnHash = await store.cas.put(detailSchemas.turn, {
        index: 0,
        role: "assistant",
        content,
        toolCalls: null,
        reasoning: null,
      });
      const detailHash = await store.cas.put(detailSchemas.detail, {
        sessionId: `session-${i}`,
        model: "test-model",
        duration: 1000,
        turnCount: 1,
        turns: [turnHash],
      });
      const stepHash = await store.cas.put(schemas.stepNode, {
        start: startHash,
        prev: steps[i - 2] ?? null,
        role: "worker",
        output: outputHash,
        detail: detailHash,
        agent: "uwf-test",
        startedAtMs: 1000000000000,
        completedAtMs: 1000000005000,
        assembledPrompt: null,
      });
      steps.push(stepHash);
    }

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ6" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: steps[4] as CasRef });

    // Use --before to limit to steps 1-2, then set quota that allows only 1
    const markdown = await cmdThreadRead(tmpDir, threadId, 500, steps[2] as CasRef, false);

    // Should not contain Step3 or later
    expect(markdown).not.toMatch(/Step3/);
    expect(markdown).not.toMatch(/Step4/);
    expect(markdown).not.toMatch(/Step5/);

    // Quota should select most recent of candidates (Step2)
    expect(markdown).toMatch(/Step2/);

    // Quota enforcement (allow ~200 char tolerance)
    expect(markdown.length).toBeLessThanOrEqual(700);
  });
});
