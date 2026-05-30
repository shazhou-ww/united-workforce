import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, putSchema } from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";
import type { CasRef, ThreadId } from "@uncaged/workflow-protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdThreadRead, THREAD_READ_DEFAULT_QUOTA } from "../commands/thread.js";
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
  // Set UNCAGED_CAS_DIR to use the test's CAS directory
  process.env.UNCAGED_CAS_DIR = casDir;
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

// ── thread read XML tag isolation ─────────────────────────────────────────────

describe("thread read XML tag isolation", () => {
  test("scenario 1: wraps output in XML tags instead of heading", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        planner: {
          description: "Planner",
          goal: "You are a planning agent. Your task is to...",
          capabilities: [],
          procedure: "Plan the work.",
          output: "Summarize the plan.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Fix issue #459",
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
      content:
        "---\nstatus: ready\nplan: CMWGHQKT58RY4\n---\n\n# Analysis Complete\n## Issue Summary\nThe issue requires XML tag isolation.",
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
      role: "planner",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-claude-code",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000001" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    // Should wrap output in XML tags
    expect(markdown).toContain("<output>");
    expect(markdown).toContain("</output>");

    // Should not have ### Content heading
    expect(markdown).not.toContain("### Content");

    // Should preserve markdown headings inside output tags
    expect(markdown).toContain("# Analysis Complete");
    expect(markdown).toContain("## Issue Summary");
  });

  test("scenario 2: wraps prompt in XML tags", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        planner: {
          description: "Planner",
          goal: "You are a planning agent. Your task is to analyze and plan.",
          capabilities: [],
          procedure: "Plan the work.",
          output: "Summarize the plan.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Fix issue",
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
      content: "---\nstatus: ready\n---\n\nContent here...",
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
      role: "planner",
      output: outputHash,
      detail: detailHash,
      agent: "uwf-claude-code",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000002" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    // Should wrap prompt in XML tags
    expect(markdown).toContain("<prompt>");
    expect(markdown).toContain("</prompt>");
    expect(markdown).toContain("You are a planning agent. Your task is to analyze and plan.");

    // Should not have ### Prompt heading
    expect(markdown).not.toContain("### Prompt");

    // Should wrap output in XML tags
    expect(markdown).toContain("<output>");
    expect(markdown).toContain("</output>");
  });

  test("scenario 3: same role repeated does not show prompt twice", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        writer: {
          description: "Writer",
          goal: "You are a writer agent.",
          capabilities: [],
          procedure: "Write content.",
          output: "Summarize writing.",
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

    const step1 = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "writer",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const step2 = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step1 as CasRef,
      role: "writer",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000003" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: step2 });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    // Should only show prompt tags once
    const promptCount = (markdown.match(/<prompt>/g) ?? []).length;
    expect(promptCount).toBe(1);
  });

  test("scenario 4: step with no detail shows no output tags", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        worker: {
          description: "Worker",
          goal: "You are a worker agent.",
          capabilities: [],
          procedure: "Do work.",
          output: "Summarize work.",
          meta: "placeholder00" as CasRef,
        },
      },
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

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000004" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    // Should not have output tags
    expect(markdown).not.toContain("<output>");
    expect(markdown).not.toContain("</output>");

    // Step header should still be displayed
    expect(markdown).toContain("## Step 1: worker");

    // Prompt should still be shown
    expect(markdown).toContain("<prompt>");
  });

  test("scenario 5: empty content shows no output tags", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
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

    // A detail ref that doesn't exist → extractLastAssistantContent returns null
    const missingDetailRef = "missingdetail0" as CasRef;

    const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "worker",
      output: outputHash,
      detail: missingDetailRef,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000005" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    // Should not have output tags
    expect(markdown).not.toContain("<output>");
    expect(markdown).not.toContain("</output>");
  });

  test("scenario 6: thread read with --start flag shows task section", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        roleA: {
          description: "Role A",
          goal: "Goal for roleA",
          capabilities: [],
          procedure: "Do stuff.",
          output: "Output.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Initial prompt",
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
      role: "roleA",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000006" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, true);

    // Should include task section
    expect(markdown).toContain("# Thread");
    expect(markdown).toContain("## Task");
    expect(markdown).toContain("Initial prompt");

    // Prompts should use XML tags
    expect(markdown).toContain("<prompt>");
  });

  test("scenario 7: thread read with --before parameter", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        roleA: {
          description: "Role A",
          goal: "Goal for roleA",
          capabilities: [],
          procedure: "Do stuff.",
          output: "Output.",
          meta: "placeholder00" as CasRef,
        },
        roleB: {
          description: "Role B",
          goal: "Goal for roleB",
          capabilities: [],
          procedure: "Do stuff.",
          output: "Output.",
          meta: "placeholder00" as CasRef,
        },
        roleC: {
          description: "Role C",
          goal: "Goal for roleC",
          capabilities: [],
          procedure: "Do stuff.",
          output: "Output.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Initial prompt",
    });

    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const step1 = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: null,
      role: "roleA",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const step2 = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step1 as CasRef,
      role: "roleB",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const step3 = await uwf.store.put(uwf.schemas.stepNode, {
      start: startHash,
      prev: step2 as CasRef,
      role: "roleC",
      output: outputHash,
      detail: null,
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000007" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: step3 });

    const markdown = await cmdThreadRead(
      tmpDir,
      threadId,
      THREAD_READ_DEFAULT_QUOTA,
      step2 as CasRef,
      false,
    );

    // Should only show roleA
    expect(markdown).toContain("roleA");
    expect(markdown).not.toContain("roleB");
    expect(markdown).not.toContain("roleC");

    // Should use XML tags
    expect(markdown).toContain("<prompt>");
  });

  test("scenario 9: special characters in content are preserved", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const detailSchemas = await registerDetailSchemas(uwf.store);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        writer: {
          description: "Writer",
          goal: "You are a writer.",
          capabilities: [],
          procedure: "Write content.",
          output: "Summarize.",
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
      content: "Content with <special> & characters > like <this>",
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
      agent: "uwf-test",
      startedAtMs: 1000000000000,
      completedAtMs: 1000000005000,
      assembledPrompt: null,
    });

    const threadId = "01JTEST0000000000000008" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: stepHash });

    const markdown = await cmdThreadRead(tmpDir, threadId, THREAD_READ_DEFAULT_QUOTA, null, false);

    // Special characters should be preserved as-is
    expect(markdown).toContain("Content with <special> & characters > like <this>");
  });

  test("scenario 10: quota limit with XML tags", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "test-wf",
      description: "desc",
      roles: {
        roleA: {
          description: "Role A",
          goal: "Goal for roleA",
          capabilities: [],
          procedure: "Do stuff.",
          output: "Output.",
          meta: "placeholder00" as CasRef,
        },
      },
      conditions: {},
      graph: {},
    });

    const startHash = await uwf.store.put(uwf.schemas.startNode, {
      workflow: workflowHash,
      prompt: "Initial prompt",
    });

    const outputHash = await uwf.store.put(uwf.schemas.workflow, {
      name: "out",
      description: "",
      roles: {},
      conditions: {},
      graph: {},
    });

    const steps: CasRef[] = [];
    let prev: CasRef | null = null;
    for (let i = 0; i < 5; i++) {
      const step = (await uwf.store.put(uwf.schemas.stepNode, {
        start: startHash,
        prev,
        role: "roleA",
        output: outputHash,
        detail: null,
        agent: "uwf-test",
        startedAtMs: 1000000000000,
        completedAtMs: 1000000005000,
        assembledPrompt: null,
      })) as CasRef;
      steps.push(step);
      prev = step;
    }

    const threadId = "01JTEST0000000000000009" as ThreadId;
    await saveThreadsIndex(tmpDir, { [threadId]: steps[steps.length - 1]! });

    // Use very small quota
    const markdown = await cmdThreadRead(tmpDir, threadId, 1, null, false);

    // Should have skip hint
    expect(markdown).toContain("earlier step");

    // Should have XML tags for displayed steps
    if (markdown.includes("<prompt>")) {
      expect(markdown).toContain("</prompt>");
    }
  });
});
