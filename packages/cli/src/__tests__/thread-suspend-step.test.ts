import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import { createFsStore } from "@ocas/fs";
import type { CasRef, StepNodePayload, ThreadId } from "@united-workforce/protocol";
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

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-suspend-step-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("suspend step CAS chain and threads.yaml metadata", () => {
  test("thread exec records suspend step in CAS and suspend metadata in threads.yaml", async () => {
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const originalCasDir = process.env.OCAS_DIR;
    process.env.OCAS_DIR = casDir;

    try {
      const store = createFsStore(casDir);
      const schemas = await registerUwfSchemas(store);

      const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

      const workflowHash = await store.put(schemas.workflow, {
        name: "test-suspend-step",
        description: "suspend step integration test",
        roles: {
          worker: {
            description: "Worker role",
            goal: "Work",
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
              prompt: "Please clarify: {{{question}}}",
              location: null,
            },
          },
        },
      });

      const startHash = await store.put(schemas.startNode, {
        workflow: workflowHash,
        prompt: "Test suspend task",
        cwd: tmpDir,
      });

      const threadId = "01SUSPENDSTEPTEST0000000" as ThreadId;
      await seedThreads(tmpDir, { [threadId]: startHash });

      const outputHash = await store.put(outputSchemaHash, {
        $status: "needs_input",
        question: "Which API?",
      });
      const detailHash = await store.put(schemas.text, "mock detail");

      const startedAtMs = 1716600000000;
      const completedAtMs = 1716600001500;

      const stepHash = await store.put(schemas.stepNode, {
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

      const mockAgentPath = join(tmpDir, "mock-agent.sh");
      const adapterJson = JSON.stringify({
        stepHash,
        detailHash,
        role: "worker",
        frontmatter: { $status: "needs_input", question: "Which API?" },
        body: "",
        startedAtMs,
        completedAtMs,
      });
      await writeFile(mockAgentPath, `#!/bin/sh\necho '${adapterJson}'\n`, { mode: 0o755 });

      const configPath = join(tmpDir, "config.yaml");
      await writeFile(
        configPath,
        `defaultAgent: uwf-hermes\ndefaultModel: test-model\nagentOverrides: null\nagents: {}\nproviders: {}\nmodels: {}\n`,
      );

      const cliPath = join(import.meta.dirname, "..", "cli.js");
      const stdout = execFileSync(
        "bun",
        ["run", cliPath, "thread", "exec", threadId, "--agent", mockAgentPath],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            WORKFLOW_STORAGE_ROOT: tmpDir,
            OCAS_DIR: casDir,
          },
          cwd: tmpDir,
          timeout: 30000,
        },
      );

      const cliOutput = JSON.parse(stdout.trim());
      expect(cliOutput.status).toBe("suspended");
      expect(cliOutput.head).toBe(stepHash);
      expect(cliOutput.suspendedRole).toBe("worker");
      expect(cliOutput.suspendMessage).toBe("Please clarify: Which API?");

      const storeAfter = createFsStore(casDir);
      const stepNode = storeAfter.get(cliOutput.head as CasRef);
      expect(stepNode).not.toBeNull();
      const payload = stepNode!.payload as StepNodePayload;
      expect(payload.role).toBe("worker");
      expect(payload.output).toBe(outputHash);

      const outputNode = storeAfter.get(outputHash);
      expect(outputNode?.payload).toEqual({
        $status: "needs_input",
        question: "Which API?",
      });

      const { createUwfStore, getThread } = await import("../store.js");
      const uwf = await createUwfStore(tmpDir);
      const threadEntry = getThread(uwf.varStore, threadId);
      expect(threadEntry).toEqual({
        head: stepHash,
        suspendedRole: "worker",
        suspendMessage: "Please clarify: Which API?",
      });

      const showResult = await cmdThreadShow(tmpDir, threadId);
      expect(showResult.status).toBe("suspended");
      expect(showResult.suspendMessage).toBe("Please clarify: Which API?");
      expect(showResult.suspendedRole).toBe("worker");
    } finally {
      if (originalCasDir === undefined) {
        delete process.env.OCAS_DIR;
      } else {
        process.env.OCAS_DIR = originalCasDir;
      }
    }
  });
});
