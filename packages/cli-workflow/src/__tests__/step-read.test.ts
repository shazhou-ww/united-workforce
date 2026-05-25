import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, putSchema } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";
import type { CasRef } from "@uncaged/workflow-protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdStepRead } from "../commands/step.js";
import { registerUwfSchemas } from "../schemas.js";

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
      items: { type: "string" as const, format: "cas_ref" },
    },
  },
  additionalProperties: false,
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function registerDetailSchemas(store: ReturnType<typeof createFsStore>) {
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

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-step-read-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── step read tests ───────────────────────────────────────────────────────────

describe("step read", () => {
  test("test 1: basic single-step read with 3 turns", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.put(schemas.workflow, {
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

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 3 turns
    const turnHashes: CasRef[] = [];
    for (let i = 1; i <= 3; i++) {
      const content = `Turn ${i} content with some text to make it readable.`;
      const turnHash = await store.put(detailSchemas.turn, {
        index: i - 1,
        role: "assistant",
        content,
        toolCalls: null,
        reasoning: null,
      });
      turnHashes.push(turnHash);
    }

    const detailHash = await store.put(detailSchemas.detail, {
      sessionId: "session-1",
      model: "test-model",
      duration: 1000,
      turnCount: 3,
      turns: turnHashes,
    });

    const stepHash = await store.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
    });

    // Read step with large quota
    const markdown = await cmdStepRead(tmpDir, stepHash, 10000);

    // Assert structure
    expect(markdown).toContain(`# Step ${stepHash}`);
    expect(markdown).toContain("**Role:** worker");
    expect(markdown).toContain("**Agent:** uwf-test");
    expect(markdown).toContain("## Turn 1");
    expect(markdown).toContain("## Turn 2");
    expect(markdown).toContain("## Turn 3");
    expect(markdown).toContain("Turn 1 content with some text to make it readable.");
    expect(markdown).toContain("Turn 2 content with some text to make it readable.");
    expect(markdown).toContain("Turn 3 content with some text to make it readable.");
  });

  test("test 2: quota enforcement - multiple turns", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.put(schemas.workflow, {
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

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 4 turns of ~300 chars each
    const turnHashes: CasRef[] = [];
    for (let i = 1; i <= 4; i++) {
      const content = generateContent(300, `Turn${i}`);
      const turnHash = await store.put(detailSchemas.turn, {
        index: i - 1,
        role: "assistant",
        content,
        toolCalls: null,
        reasoning: null,
      });
      turnHashes.push(turnHash);
    }

    const detailHash = await store.put(detailSchemas.detail, {
      sessionId: "session-1",
      model: "test-model",
      duration: 1000,
      turnCount: 4,
      turns: turnHashes,
    });

    const stepHash = await store.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
    });

    // Read step with limited quota (700 chars)
    const markdown = await cmdStepRead(tmpDir, stepHash, 700);

    // Assert only most recent turns fit
    expect(markdown).toContain(`# Step ${stepHash}`);
    // Should have skip hint
    expect(markdown).toContain("Earlier turns omitted");
    // Should include at least Turn 4 (most recent)
    expect(markdown).toContain("Turn4");
    // Total length should respect quota (with tolerance for structural overhead)
    expect(markdown.length).toBeLessThanOrEqual(900); // 700 quota + 200 buffer tolerance
  });

  test("test 3: minimal quota edge case - always show at least one turn", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.put(schemas.workflow, {
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

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create 1 turn of 500 chars
    const content = generateContent(500, "LongTurn");
    const turnHash = await store.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content,
      toolCalls: null,
      reasoning: null,
    });

    const detailHash = await store.put(detailSchemas.detail, {
      sessionId: "session-1",
      model: "test-model",
      duration: 1000,
      turnCount: 1,
      turns: [turnHash],
    });

    const stepHash = await store.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
    });

    // Read step with minimal quota (1 char)
    const markdown = await cmdStepRead(tmpDir, stepHash, 1);

    // Assert at least one turn is always shown
    expect(markdown).toContain("LongTurn");
    expect(markdown.length).toBeGreaterThan(1);
  });

  test("test 4: step with no detail field", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);

    const workflowHash = await store.put(schemas.workflow, {
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

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const stepHash = await store.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
    });

    // Read step - should return metadata only (no error)
    const markdown = await cmdStepRead(tmpDir, stepHash, 4000);

    // Assert metadata is present
    expect(markdown).toContain(`# Step ${stepHash}`);
    expect(markdown).toContain("**Role:** worker");
    expect(markdown).toContain("**Agent:** uwf-test");
    // Should not have turn sections
    expect(markdown).not.toContain("## Turn");
  });

  test("test 5: step with detail but no turns array", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);
    await registerDetailSchemas(store);

    const workflowHash = await store.put(schemas.workflow, {
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

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create detail with different schema (no turns)
    const SIMPLE_DETAIL_SCHEMA = {
      title: "simple-detail",
      type: "object" as const,
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string" as const },
      },
      additionalProperties: false,
    };

    await bootstrap(store);
    const simpleDetailType = await putSchema(store, SIMPLE_DETAIL_SCHEMA);
    const detailHash = await store.put(simpleDetailType, {
      sessionId: "session-1",
    });

    const stepHash = await store.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
    });

    // Read step - should return metadata only (no error)
    const markdown = await cmdStepRead(tmpDir, stepHash, 4000);

    // Assert metadata is present
    expect(markdown).toContain(`# Step ${stepHash}`);
    expect(markdown).toContain("**Role:** worker");
    // Should not have turn sections
    expect(markdown).not.toContain("## Turn");
  });

  test("test 6: turn content with special characters", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.put(schemas.workflow, {
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

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test task",
    });

    const outputHash = await store.put(schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // Create turn with special markdown characters
    const content = "This has `backticks`, **bold**, *italic*, and [links](http://example.com)";
    const turnHash = await store.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content,
      toolCalls: null,
      reasoning: null,
    });

    const detailHash = await store.put(detailSchemas.detail, {
      sessionId: "session-1",
      model: "test-model",
      duration: 1000,
      turnCount: 1,
      turns: [turnHash],
    });

    const stepHash = await store.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
    });

    // Read step
    const markdown = await cmdStepRead(tmpDir, stepHash, 4000);

    // Assert content is rendered correctly without corruption
    expect(markdown).toContain("`backticks`");
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("*italic*");
    expect(markdown).toContain("[links](http://example.com)");
  });
});
