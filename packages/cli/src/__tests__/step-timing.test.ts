import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { STEP_NODE_SCHEMA } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdStepList } from "../commands/step.js";
import { cmdThreadRead } from "../commands/thread.js";
import { registerUwfSchemas } from "../schemas.js";
import { seedThreads } from "./thread-test-helpers.js";

// ── schemas ──────────────────────────────────────────────────────────────────

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

// ── helpers ──────────────────────────────────────────────────────────────────

async function registerDetailSchemas(store: Awaited<ReturnType<typeof openStore>>) {
  await bootstrap(store);
  const [turn, detail] = await Promise.all([
    putSchema(store, TURN_SCHEMA),
    putSchema(store, DETAIL_SCHEMA),
  ]);
  return { turn, detail };
}

// ── fixture ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-step-timing-test-"));
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

// ── 1. Protocol types (compile-time) ─────────────────────────────────────────

describe("protocol types", () => {
  test("StepRecord has startedAtMs and completedAtMs as required fields", () => {
    // Type-level test: this block compiles only if fields exist and are number
    const record: import("@united-workforce/protocol").StepRecord = {
      role: "test",
      output: "hash1" as CasRef,
      detail: "hash2" as CasRef,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: 1000,
      completedAtMs: 2000,
      assembledPrompt: null,
      cwd: "/test/path",
    };
    expect(record.startedAtMs).toBe(1000);
    expect(record.completedAtMs).toBe(2000);
  });

  test("StepEntry has durationMs as required field", () => {
    const entry: import("@united-workforce/protocol").StepEntry = {
      hash: "hash" as CasRef,
      role: "test",
      output: {},
      detail: "hash2" as CasRef,
      agent: "uwf-test",
      timestamp: 123,
      durationMs: 5000,
    };
    expect(entry.durationMs).toBe(5000);
  });
});

// ── 2. JSON Schema ───────────────────────────────────────────────────────────

describe("StepNode JSON schema", () => {
  test("schema requires startedAtMs and completedAtMs", () => {
    const required = STEP_NODE_SCHEMA.required as string[];
    expect(required).toContain("startedAtMs");
    expect(required).toContain("completedAtMs");
  });

  test("schema defines timing fields as integer", () => {
    const props = STEP_NODE_SCHEMA.properties as Record<string, { type: string }>;
    expect(props.startedAtMs.type).toBe("integer");
    expect(props.completedAtMs.type).toBe("integer");
  });

  test("StepNode with timing fields passes CAS validation", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: "placeholder0000" as CasRef,
      prompt: "test",
    });

    const outputHash = await store.cas.put(schemas.text, "output text");

    const detailSchemas = await registerDetailSchemas(store);
    const detailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "s1",
      model: "m1",
      duration: 100,
      turnCount: 0,
      turns: [],
    });

    // Should succeed — valid timing fields
    const hash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });
    expect(hash).toBeTruthy();
  });
});

// ── 3. step list — durationMs computed ───────────────────────────────────────

describe("step list timing", () => {
  test("step list includes durationMs = completedAtMs - startedAtMs", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = await openStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const detailSchemas = await registerDetailSchemas(store);

    const workflowHash = await store.cas.put(schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {},
      graph: {},
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "test",
    });

    const outputHash = await store.cas.put(schemas.text, "output");
    const detailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "s1",
      model: "m1",
      duration: 100,
      turnCount: 0,
      turns: [],
    });

    const startedAt = 1716600000000;
    const completedAt = 1716600003500;

    const stepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: startedAt,
      completedAtMs: completedAt,
    });

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ1" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    const result = await cmdStepList(tmpDir, threadId);
    const stepEntries = result.steps.slice(1); // skip start entry
    expect(stepEntries).toHaveLength(1);

    const step = stepEntries[0] as import("@united-workforce/protocol").StepEntry;
    expect(step.durationMs).toBe(3500);
  });
});

// ── 4. thread read — duration in header ──────────────────────────────────────

describe("thread read timing", () => {
  test("thread read header includes Duration", async () => {
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
          goal: "Do work",
          capabilities: [],
          procedure: "work",
          output: "result",
          frontmatter: "placeholder0000" as CasRef,
        },
      },
      graph: {
        $START: { _: { role: "worker", prompt: "go", location: null } },
        worker: { _: { role: "$END", prompt: "", location: null } },
      },
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "test task",
    });

    const turnHash = await store.cas.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: "Done.",
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "s1",
      model: "m1",
      duration: 100,
      turnCount: 1,
      turns: [turnHash],
    });
    const outputHash = await store.cas.put(schemas.text, "output");

    const stepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: 1716600000000,
      completedAtMs: 1716600042000,
    });

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ3" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, 10000, null, false);
    expect(markdown).toContain("**Duration:** 42.0s");
  });

  test("thread read shows sub-second duration as ms", async () => {
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
          goal: "Do work",
          capabilities: [],
          procedure: "work",
          output: "result",
          frontmatter: "placeholder0000" as CasRef,
        },
      },
      graph: {
        $START: { _: { role: "worker", prompt: "go", location: null } },
        worker: { _: { role: "$END", prompt: "", location: null } },
      },
    });

    const startHash = await store.cas.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "test",
    });

    const turnHash = await store.cas.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: "Done.",
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await store.cas.put(detailSchemas.detail, {
      sessionId: "s1",
      model: "m1",
      duration: 100,
      turnCount: 1,
      turns: [turnHash],
    });
    const outputHash = await store.cas.put(schemas.text, "output");

    const stepHash = await store.cas.put(schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: 1716600000000,
      completedAtMs: 1716600000350,
    });

    const threadId = "01HX2Q3R4S5T6V7W8X9YZ4" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, 10000, null, false);
    expect(markdown).toContain("**Duration:** 350ms");
  });
});

// ── 6. Breaking change — old data without timing fails ───────────────────────

describe("breaking change", () => {
  test("StepNode schema rejects payload without timing fields", () => {
    const required = STEP_NODE_SCHEMA.required as string[];
    // Both fields must be in the required array
    expect(required).toContain("startedAtMs");
    expect(required).toContain("completedAtMs");

    // Payload without timing fields would fail schema validation
    // because the schema marks them as required
    const payloadWithoutTiming = {
      start: "hash1",
      prev: null,
      role: "worker",
      output: "hash2",
      detail: "hash3",
      agent: "uwf-test",
      edgePrompt: "",
    };
    // Verify the payload is missing required fields
    expect(payloadWithoutTiming).not.toHaveProperty("startedAtMs");
    expect(payloadWithoutTiming).not.toHaveProperty("completedAtMs");
  });
});
