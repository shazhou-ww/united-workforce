import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type { ThreadId } from "@united-workforce/protocol";
import { createThreadIndexEntry, markThreadSuspended } from "@united-workforce/protocol";
import { cmdThreadList, cmdThreadShow } from "../commands/thread.js";
import { createUwfStore } from "../store.js";
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

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-suspended-display-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("suspended thread display", () => {
  test("thread list shows [suspended] marker for suspended threads", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const originalCasDir = process.env.OCAS_DIR;
    process.env.OCAS_DIR = casDir;

    try {
      const uwf = await createUwfStore(tmpDir);
      const outputSchemaHash = await putSchema(uwf.store, OUTPUT_SCHEMA);

      // Create test workflow with suspend capability
      const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
        name: "test-suspend-display",
        description: "test suspended display",
        roles: {
          worker: {
            description: "Worker role",
            goal: "Work and potentially suspend",
            capabilities: [],
            procedure: "work",
            output: "result",
            frontmatter: outputSchemaHash,
          },
        },
        graph: {
          $START: { _: { role: "worker", prompt: "Start work", location: null } },
          worker: {
            needs_input: {
              role: "$SUSPEND",
              prompt: "Please provide more details: {{{question}}}",
              location: null,
            },
          },
        },
      });

      const startHash = await uwf.store.put(uwf.schemas.startNode, {
        workflow: workflowHash,
        prompt: "Test task requiring input",
        cwd: tmpDir,
      });

      // Create suspended thread
      const suspendedThreadId = "01SUSPENDEDTHREAD0000000" as ThreadId;
      const outputHash = await uwf.store.put(outputSchemaHash, {
        $status: "needs_input",
        question: "What is the target API?",
      });
      const detailHash = await uwf.store.put(uwf.schemas.text, "mock detail");

      const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
        start: startHash,
        prev: null,
        role: "worker",
        output: outputHash,
        detail: detailHash,
        agent: "uwf-mock",
        edgePrompt: "Start work",
        startedAtMs: 1716600000000,
        completedAtMs: 1716600001500,
        cwd: tmpDir,
        assembledPrompt: null,
      });

      // Create suspended thread entry in threads.yaml
      const suspendedEntry = markThreadSuspended(
        createThreadIndexEntry(stepHash),
        "worker",
        "Please provide more details: What is the target API?",
      );

      // Create normal (idle) thread
      const idleThreadId = "01IDLETHREAD00000000000" as ThreadId;
      const idleStartHash = await uwf.store.put(uwf.schemas.startNode, {
        workflow: workflowHash,
        prompt: "Normal task",
        cwd: tmpDir,
      });
      const idleEntry = createThreadIndexEntry(idleStartHash);

      await seedThreads(tmpDir, {
        [suspendedThreadId]: suspendedEntry,
        [idleThreadId]: idleEntry,
      });

      // Test thread list
      const listResult = await cmdThreadList(tmpDir, null, null, null, null, null);

      // Find the suspended and idle threads in results
      const suspendedItem = listResult.find((item) => item.thread === suspendedThreadId);
      const idleItem = listResult.find((item) => item.thread === idleThreadId);

      expect(suspendedItem).toBeDefined();
      expect(suspendedItem!.status).toBe("suspended");
      expect(suspendedItem!.statusDisplay).toBe("suspended [suspended]");

      expect(idleItem).toBeDefined();
      expect(idleItem!.status).toBe("idle");
      expect(idleItem!.statusDisplay).toBe("idle");
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_DIR;
      } else {
        process.env.OCAS_DIR = originalCasDir;
      }
    }
  });

  test("thread show displays suspend info and resume hint", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const originalCasDir = process.env.OCAS_DIR;
    process.env.OCAS_DIR = casDir;

    try {
      const uwf = await createUwfStore(tmpDir);
      const outputSchemaHash = await putSchema(uwf.store, OUTPUT_SCHEMA);

      const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
        name: "test-suspend-show",
        description: "test suspended show",
        roles: {
          worker: {
            description: "Worker role",
            goal: "Work and potentially suspend",
            capabilities: [],
            procedure: "work",
            output: "result",
            frontmatter: outputSchemaHash,
          },
        },
        graph: {
          $START: { _: { role: "worker", prompt: "Start work", location: null } },
          worker: {
            needs_input: {
              role: "$SUSPEND",
              prompt: "Need clarification: {{{question}}}",
              location: null,
            },
          },
        },
      });

      const startHash = await uwf.store.put(uwf.schemas.startNode, {
        workflow: workflowHash,
        prompt: "Test task",
        cwd: tmpDir,
      });

      const threadId = "01SUSPENDSHOW000000000" as ThreadId;
      const outputHash = await uwf.store.put(outputSchemaHash, {
        $status: "needs_input",
        question: "Which database to use?",
      });
      const detailHash = await uwf.store.put(uwf.schemas.text, "mock detail");

      const stepHash = await uwf.store.put(uwf.schemas.stepNode, {
        start: startHash,
        prev: null,
        role: "worker",
        output: outputHash,
        detail: detailHash,
        agent: "uwf-mock",
        edgePrompt: "Start work",
        startedAtMs: 1716600000000,
        completedAtMs: 1716600001500,
        cwd: tmpDir,
        assembledPrompt: null,
      });

      const suspendedEntry = markThreadSuspended(
        createThreadIndexEntry(stepHash),
        "worker",
        "Need clarification: Which database to use?",
      );

      await seedThreads(tmpDir, { [threadId]: suspendedEntry });

      // Test thread show
      const showResult = await cmdThreadShow(tmpDir, threadId);

      expect(showResult.status).toBe("suspended");
      expect(showResult.suspendedRole).toBe("worker");
      expect(showResult.suspendMessage).toBe("Need clarification: Which database to use?");
      expect(showResult.hint).toBe(
        `Thread is suspended. Resume with: uwf thread resume ${threadId}`,
      );
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_DIR;
      } else {
        process.env.OCAS_DIR = originalCasDir;
      }
    }
  });

  test("non-suspended threads do not show suspend markers or hints", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const originalCasDir = process.env.OCAS_DIR;
    process.env.OCAS_DIR = casDir;

    try {
      const uwf = await createUwfStore(tmpDir);

      const workflowHash = await uwf.store.put(uwf.schemas.workflow, {
        name: "test-normal",
        description: "test normal thread",
        roles: {
          worker: {
            description: "Worker role",
            goal: "Work normally",
            capabilities: [],
            procedure: "work",
            output: "result",
          },
        },
        graph: {
          $START: { _: { role: "worker", prompt: "Start work", location: null } },
        },
      });

      const startHash = await uwf.store.put(uwf.schemas.startNode, {
        workflow: workflowHash,
        prompt: "Normal task",
        cwd: tmpDir,
      });

      const threadId = "01NORMALTHREAD000000000" as ThreadId;
      await seedThreads(tmpDir, { [threadId]: createThreadIndexEntry(startHash) });

      // Test thread show
      const showResult = await cmdThreadShow(tmpDir, threadId);

      expect(showResult.status).toBe("idle");
      expect(showResult.suspendedRole).toBeNull();
      expect(showResult.suspendMessage).toBeNull();
      expect(showResult.hint).toBeNull();

      // Test thread list
      const listResult = await cmdThreadList(tmpDir, null, null, null, null, null);
      const threadItem = listResult.find((item) => item.thread === threadId);

      expect(threadItem).toBeDefined();
      expect(threadItem!.status).toBe("idle");
      expect(threadItem!.statusDisplay).toBe("idle");
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_DIR;
      } else {
        process.env.OCAS_DIR = originalCasDir;
      }
    }
  });
});
