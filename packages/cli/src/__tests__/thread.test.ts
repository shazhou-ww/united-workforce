import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, putSchema } from "@ocas/core";
import type { createFsStore } from "@ocas/fs";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { cmdStepList, cmdStepShow } from "../commands/step.js";
import {
  cmdThreadRead,
  extractLastAssistantContent,
  THREAD_READ_DEFAULT_QUOTA,
} from "../commands/thread.js";
import type { UwfStore } from "../store.js";
import { addHistoryEntry, createUwfStore } from "../store.js";
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

async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_DIR = casDir;
  return createUwfStore(storageRoot);
}

async function registerDetailSchemas(store: ReturnType<typeof createFsStore>) {
  await bootstrap(store);
  const [turn, detail] = await Promise.all([
    putSchema(store, TURN_SCHEMA),
    putSchema(store, DETAIL_SCHEMA),
  ]);
  return { turn, detail };
}

// ── fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── extractLastAssistantContent ───────────────────────────────────────────────

describe("extractLastAssistantContent", () => {
  test("returns last non-empty assistant content from turns", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const schemas = await registerDetailSchemas(uwf.store);

    const turn1 = await uwf.store.put(schemas.turn, {
      index: 0,
      role: "assistant",
      content: "intermediate",
      toolCalls: null,
      reasoning: null,
    });
    const turn2 = await uwf.store.put(schemas.turn, {
      index: 1,
      role: "tool",
      content: "ok",
      toolCalls: null,
      reasoning: null,
    });
    const turn3 = await uwf.store.put(schemas.turn, {
      index: 2,
      role: "assistant",
      content: "final answer",
      toolCalls: null,
      reasoning: null,
    });

    const detailHash = await uwf.store.put(schemas.detail, {
      sessionId: "s1",
      model: "m1",
      duration: 1000,
      turnCount: 3,
      turns: [turn1, turn2, turn3],
    });

    expect(extractLastAssistantContent(uwf, detailHash)).toBe("final answer");
  });

  test("returns null when detail node does not exist in store", async () => {
    const uwf = await makeUwfStore(tmpDir);
    expect(extractLastAssistantContent(uwf, "nonexistent00" as CasRef)).toBeNull();
  });

  test("returns null when turns array is empty", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const schemas = await registerDetailSchemas(uwf.store);

    const detailHash = await uwf.store.put(schemas.detail, {
      sessionId: "s2",
      model: "m2",
      duration: 0,
      turnCount: 0,
      turns: [],
    });

    expect(extractLastAssistantContent(uwf, detailHash)).toBeNull();
  });

  test("returns null when all assistant turns have empty content", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const schemas = await registerDetailSchemas(uwf.store);

    const turn1 = await uwf.store.put(schemas.turn, {
      index: 0,
      role: "assistant",
      content: "",
      toolCalls: null,
      reasoning: null,
    });

    const detailHash = await uwf.store.put(schemas.detail, {
      sessionId: "s3",
      model: "m3",
      duration: 0,
      turnCount: 1,
      turns: [turn1],
    });

    expect(extractLastAssistantContent(uwf, detailHash)).toBeNull();
  });

  test("skips whitespace-only assistant content and returns earlier match", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const schemas = await registerDetailSchemas(uwf.store);

    const turn1 = await uwf.store.put(schemas.turn, {
      index: 0,
      role: "assistant",
      content: "real content",
      toolCalls: null,
      reasoning: null,
    });
    const turn2 = await uwf.store.put(schemas.turn, {
      index: 1,
      role: "assistant",
      content: "   ",
      toolCalls: null,
      reasoning: null,
    });

    const detailHash = await uwf.store.put(schemas.detail, {
      sessionId: "s4",
      model: "m4",
      duration: 0,
      turnCount: 2,
      turns: [turn1, turn2],
    });

    expect(extractLastAssistantContent(uwf, detailHash)).toBe("real content");
  });
});

// ── cmdThreadRead: <output> section ──────────────────────────────────────────

describe("cmdThreadRead <output> section", () => {
  test("includes <output> tags when detail has assistant turns", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        writer: {
          description: "Write",
          goal: "You are a writer.",
          capabilities: [],
          procedure: "Write content as requested.",
          output: "Summarize what was written.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Write something",
    });

    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const turnHash = await uwf.store.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: "The assistant response text",
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await uwf.store.put(detailSchemas.detail, {
      sessionId: "sx",
      model: "mx",
      duration: 500,
      turnCount: 1,
      turns: [turnHash],
    });

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "writer",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-hermes",
    });

    const threadId = "01JTEST0000000000000000001" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    expect(markdown).toContain("<output>");
    expect(markdown).toContain("</output>");
    expect(markdown).toContain("The assistant response text");
    expect(markdown).not.toContain("### Content");
  });

  test("omits <output> tags when detail has no matching assistant turns", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf2",
      description: "desc",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Do stuff",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    // A detail ref that doesn't exist in the store → extractLastAssistantContent returns null
    const missingDetailRef = "missingdetail0" as CasRef;

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: missingDetailRef,
      agent: "uwf-hermes",
    });

    const threadId = "01JTEST0000000000000000002" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    expect(markdown).not.toContain("<output>");
    expect(markdown).not.toContain("</output>");
    expect(markdown).not.toContain("### Content");
  });
});

// ── cmdStepShow ───────────────────────────────────────────────────────────────

describe("cmdStepShow", () => {
  test("returns expanded detail node with turns inlined", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "wf",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "p",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const turnHash = await uwf.store.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: "done",
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await uwf.store.put(detailSchemas.detail, {
      sessionId: "sess42",
      model: "gpt-4o",
      duration: 3000,
      turnCount: 1,
      turns: [turnHash],
    });

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "coder",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-hermes",
    });

    const result = await cmdStepShow(tmpDir, stepHash);

    expect(result).toMatchObject({
      sessionId: "sess42",
      model: "gpt-4o",
      duration: 3000,
      turnCount: 1,
    });

    const expanded = result as Record<string, unknown>;
    expect(Array.isArray(expanded.turns)).toBe(true);
    const turns = expanded.turns as unknown[];
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      index: 0,
      role: "assistant",
      content: "done",
    });
  });
});

// ── cmdThreadRead: <prompt> deduplication ────────────────────────────────────

describe("cmdThreadRead <prompt> deduplication", () => {
  async function makeThreadWithRoles(uwf: UwfStore, roles: string[]): Promise<string> {
    const roleMap: Record<string, unknown> = {};
    for (const r of [...new Set(roles)]) {
      roleMap[r] = {
        description: r,
        goal: `Goal for ${r}`,
        capabilities: [],
        procedure: "Do stuff.",
        output: "Output.",
        meta: "placeholder00" as CasRef,
      };
    }
    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "dedup-wf",
      description: "desc",
      roles: roleMap,
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Start",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    let prev: string | null = null;
    let stepHash = "";
    for (const role of roles) {
      stepHash = await uwf.store.put(uwf.schemas.stepNode, {
        start: startHash,
        prev: prev as CasRef | null,
        role,
        output: outputHash,
        detail: null,
        agent: "uwf-test",
      });
      prev = stepHash;
    }
    return stepHash;
  }

  test("same consecutive role shows <prompt> once", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const headHash = await makeThreadWithRoles(uwf, ["writer", "writer"]);
    const threadId = "01JTEST0000000000000003" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: headHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    const count = (markdown.match(/<prompt>/g) ?? []).length;
    expect(count).toBe(1);
  });

  test("different consecutive roles each show <prompt>", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const headHash = await makeThreadWithRoles(uwf, ["planner", "coder"]);
    const threadId = "01JTEST0000000000000004" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: headHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    const count = (markdown.match(/<prompt>/g) ?? []).length;
    expect(count).toBe(2);
  });

  test("non-consecutive same role shows <prompt> twice", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const headHash = await makeThreadWithRoles(uwf, ["roleA", "roleB", "roleA"]);
    const threadId = "01JTEST0000000000000005" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: headHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    const count = (markdown.match(/<prompt>/g) ?? []).length;
    expect(count).toBe(2);
  });
});

// ── cmdThreadRead: showStart / before / quota ─────────────────────────────────

describe("cmdThreadRead start section / before / quota", () => {
  async function makeSimpleThread(
    uwf: UwfStore,
    roles: string[],
  ): Promise<{ startHash: CasRef; stepHashes: CasRef[] }> {
    const uniqueRoles = [...new Set(roles)];
    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "simple-wf",
      description: "desc",
      roles: Object.fromEntries(
        uniqueRoles.map((r) => [
          r,
          {
            description: r,
            goal: `Goal for ${r}`,
            capabilities: [],
            procedure: "Do stuff.",
            output: "Output.",
            meta: "placeholder00" as CasRef,
          },
        ]),
      ),
      conditions: {},
      graph: {},
    });
    const startHash = (await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Initial prompt",
    })) as CasRef;
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const stepHashes: CasRef[] = [];
    let prev: CasRef | null = null;
    for (const role of roles) {
      const stepHash = (await uwf.store.put(uwf.schemas.stepNode, {
        start: startHash,
        prev,
        role,
        output: outputHash,
        detail: null,
        agent: "uwf-test",
      })) as CasRef;
      stepHashes.push(stepHash);
      prev = stepHash;
    }
    return { startHash, stepHashes };
  }

  test("showStart=true includes # Thread header and ## Task section", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA"]);
    const threadId = "01JTEST0000000000000006" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHashes[stepHashes.length - 1]! });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, true);
    expect(markdown).toContain("# Thread");
    expect(markdown).toContain("## Task");
    expect(markdown).toContain("Initial prompt");
  });

  test("showStart=false with before=null still shows # Thread header (default behavior)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA"]);
    const threadId = "01JTEST0000000000000007" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHashes[stepHashes.length - 1]! });

    // When before=null, the start section is always shown regardless of showStart
    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    expect(markdown).toContain("# Thread");
    expect(markdown).toContain("## Task");
  });

  test("before filter: only steps before the given hash appear", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA", "roleB", "roleC"]);
    const [_hashA, hashB, hashC] = stepHashes as [CasRef, CasRef, CasRef];
    const threadId = "01JTEST0000000000000008" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: hashC });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, hashB, false);
    expect(markdown).toContain("roleA");
    expect(markdown).not.toContain("roleB");
    expect(markdown).not.toContain("roleC");
  });

  test("quota=1 limits output and includes skip hint", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA", "roleB", "roleC"]);
    const threadId = "01JTEST000000000000000A" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHashes[stepHashes.length - 1]! });

    const markdown = await cmdThreadRead(tmpDir, threadId, 1, null, false);
    expect(markdown).toContain("earlier step");
  });

  test("all steps fit in quota: no skip hint", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA"]);
    const threadId = "01JTEST000000000000000B" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHashes[0]! });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    expect(markdown).not.toContain("earlier step");
  });
});

// ── Tests that call process.exit must be last ─────────────────────────────────

describe("cmdStepShow (process.exit tests - must be last)", () => {
  test("throws when step hash does not exist", async () => {
    await expect(cmdStepShow(tmpDir, "nonexistenth0" as CasRef)).rejects.toThrow();
  });

  test("before with unknown hash rejects", async () => {
    const uwfStore = await makeUwfStore(tmpDir);

    const workflowHash = await uwfStore.store.put(uwfStore.schemas.workflow, {
      name: "wf2",
      description: "",
      roles: {
        roleA: {
          description: "r",
          goal: "g",
          capabilities: [],
          procedure: "p",
          output: "o",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });
    const startHash = await uwfStore.store.put(uwfStore.schemas.startNode, {
      workflow: workflowHash,
      prompt: "p",
    });
    const outputHash = await uwfStore.store.put(uwfStore.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });
    const stepHash = await uwfStore.store.put(uwfStore.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "roleA",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });
    await seedThreads(tmpDir, { ["01JTEST000000000000000C" as ThreadId]: stepHash as CasRef });

    await expect(
      cmdThreadRead(
        tmpDir,
        "01JTEST000000000000000C" as ThreadId,
        THREAD_READ_DEFAULT_QUOTA,
        "unknownhash0" as CasRef,
        false,
      ),
    ).rejects.toThrow();
  });
});

// ── cmdStepList / cmdStepShow: completed threads ──────────────────────────────

describe("cmdStepList with completed threads", () => {
  test("lists steps from active thread", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf-active",
      description: "desc",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Start prompt",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const step1Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "role1",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });
    const step2Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step1Hash,
      role: "role2",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });
    const step3Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step2Hash,
      role: "role3",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });

    const threadId = "01JTEST0000000000000000A1" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: step3Hash });

    const result = await cmdStepList(tmpDir, threadId);

    expect(result.thread).toBe(threadId);
    expect(result.steps).toHaveLength(4); // start + 3 steps
    expect(result.steps[1].role).toBe("role1");
    expect(result.steps[2].role).toBe("role2");
    expect(result.steps[3].role).toBe("role3");
  });

  test("lists steps from completed thread", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf-completed",
      description: "desc",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Start prompt",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const step1Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "roleA",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });
    const step2Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step1Hash,
      role: "roleB",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });

    const threadId = "01JTEST0000000000000000A2" as ThreadId;
    // Thread is NOT in active index (simulating completed thread)
    // But it IS in history variable store
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: workflowHash,
      head: step2Hash,
      completedAt: Date.now(),
      reason: null,
    });

    const result = await cmdStepList(tmpDir, threadId);

    expect(result.thread).toBe(threadId);
    expect(result.steps).toHaveLength(3); // start + 2 steps
    expect(result.steps[1].role).toBe("roleA");
    expect(result.steps[2].role).toBe("roleB");
  });
});

describe("cmdStepShow with completed threads", () => {
  test("shows step detail from active thread", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf-step-active",
      description: "desc",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "p",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const turnHash = await uwf.store.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: "Active thread response",
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await uwf.store.put(detailSchemas.detail, {
      sessionId: "sess-active",
      model: "model-x",
      duration: 1234,
      turnCount: 1,
      turns: [turnHash],
    });

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "coder",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-hermes",
    });

    const threadId = "01JTEST0000000000000000B1" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: stepHash });

    const result = await cmdStepShow(tmpDir, stepHash);

    expect(result).toMatchObject({
      sessionId: "sess-active",
      model: "model-x",
      duration: 1234,
      turnCount: 1,
    });
  });

  test("shows step detail from completed thread", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf-step-completed",
      description: "desc",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "p",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const turnHash = await uwf.store.put(detailSchemas.turn, {
      index: 0,
      role: "assistant",
      content: "Completed thread response",
      toolCalls: null,
      reasoning: null,
    });
    const detailHash = await uwf.store.put(detailSchemas.detail, {
      sessionId: "sess-completed",
      model: "model-y",
      duration: 5678,
      turnCount: 1,
      turns: [turnHash],
    });

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "reviewer",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-hermes",
    });

    const threadId = "01JTEST0000000000000000B2" as ThreadId;
    // Thread is NOT in active index
    // But it IS in history variable store
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: workflowHash,
      head: stepHash,
      completedAt: Date.now(),
      reason: null,
    });

    const result = await cmdStepShow(tmpDir, stepHash);

    expect(result).toMatchObject({
      sessionId: "sess-completed",
      model: "model-y",
      duration: 5678,
      turnCount: 1,
    });
  });
});

describe("cmdThreadRead with completed threads", () => {
  test("reads completed thread context", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf-read-completed",
      description: "desc",
      roles: {
        writer: {
          description: "Write",
          goal: "You are a writer.",
          capabilities: [],
          procedure: "Write content.",
          output: "Summary.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Write something",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "writer",
      output: outputHash,
      detail: null,
      agent: "uwf-hermes",
    });

    const threadId = "01JTEST0000000000000000C1" as ThreadId;
    // Thread is NOT in active index
    // But it IS in history variable store
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: workflowHash,
      head: stepHash,
      completedAt: Date.now(),
      reason: null,
    });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    expect(markdown).toContain("writer");
    expect(markdown).toContain("Write something");
  });

  test("reads completed thread with before filter", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf-read-before",
      description: "desc",
      roles: {},
      conditions: {},
      graph: {},
    });
    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Do task",
    });
    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const step1Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "roleX",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });
    const step2Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step1Hash,
      role: "roleY",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });
    const step3Hash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step2Hash,
      role: "roleZ",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
    });

    const threadId = "01JTEST0000000000000000C2" as ThreadId;
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: workflowHash,
      head: step3Hash,
      completedAt: Date.now(),
      reason: null,
    });

    const markdown = await cmdThreadRead(
      tmpDir,
      threadId,
      THREAD_READ_DEFAULT_QUOTA,
      step2Hash,
      false,
    );

    // Should contain step1 (roleX) but not step2 (roleY) or step3 (roleZ)
    expect(markdown).toContain("roleX");
    expect(markdown).not.toContain("roleY");
    expect(markdown).not.toContain("roleZ");
  });
});
