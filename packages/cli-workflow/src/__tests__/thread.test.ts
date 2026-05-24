import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, putSchema } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";
import type { CasRef, ThreadId } from "@uncaged/workflow-protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cmdThreadRead,
  extractLastAssistantContent,
  THREAD_READ_DEFAULT_QUOTA,
} from "../commands/thread.js";
import { cmdStepShow } from "../commands/step.js";
import { registerUwfSchemas } from "../schemas.js";
import type { UwfStore } from "../store.js";
import { saveThreadsIndex } from "../store.js";

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

async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  const store = createFsStore(casDir);
  const schemas = await registerUwfSchemas(store);
  return { storageRoot, store, schemas };
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
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

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
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

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
    await saveThreadsIndex(tmpDir, { [threadId]: headHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    const count = (markdown.match(/<prompt>/g) ?? []).length;
    expect(count).toBe(1);
  });

  test("different consecutive roles each show <prompt>", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const headHash = await makeThreadWithRoles(uwf, ["planner", "coder"]);
    const threadId = "01JTEST0000000000000004" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: headHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);
    const count = (markdown.match(/<prompt>/g) ?? []).length;
    expect(count).toBe(2);
  });

  test("non-consecutive same role shows <prompt> twice", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const headHash = await makeThreadWithRoles(uwf, ["roleA", "roleB", "roleA"]);
    const threadId = "01JTEST0000000000000005" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: headHash });

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
    await saveThreadsIndex(tmpDir, { [threadId]: stepHashes[stepHashes.length - 1]! });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, true);
    expect(markdown).toContain("# Thread");
    expect(markdown).toContain("## Task");
    expect(markdown).toContain("Initial prompt");
  });

  test("showStart=false with before=null still shows # Thread header (default behavior)", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA"]);
    const threadId = "01JTEST0000000000000007" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHashes[stepHashes.length - 1]! });

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
    await saveThreadsIndex(tmpDir, { [threadId]: hashC });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, hashB, false);
    expect(markdown).toContain("roleA");
    expect(markdown).not.toContain("roleB");
    expect(markdown).not.toContain("roleC");
  });

  test("quota=1 limits output and includes skip hint", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA", "roleB", "roleC"]);
    const threadId = "01JTEST000000000000000A" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHashes[stepHashes.length - 1]! });

    const markdown = await cmdThreadRead(tmpDir, threadId, 1, null, false);
    expect(markdown).toContain("earlier step");
  });

  test("all steps fit in quota: no skip hint", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const { stepHashes } = await makeSimpleThread(uwf, ["roleA"]);
    const threadId = "01JTEST000000000000000B" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHashes[0]! });

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
    const _uwf = await makeUwfStore(tmpDir);
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);
    const uwfStore: UwfStore = { storageRoot: tmpDir, store, schemas };

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
    await saveThreadsIndex(tmpDir, { ["01JTEST000000000000000C" as ThreadId]: stepHash as CasRef });

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
