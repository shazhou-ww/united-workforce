import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import { createFsStore } from "@ocas/fs";
import type { CasRef, StepNodePayload, ThreadId } from "@united-workforce/protocol";
import { registerUwfSchemas } from "../schemas.js";
import { seedThreads } from "./thread-test-helpers.js";

// ── schemas ──────────────────────────────────────────────────────────────────

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    $status: { type: "string" as const, enum: ["done", "failed"] },
    result: { type: "string" as const },
  },
  required: ["$status"],
  additionalProperties: false,
};

// ── fixture ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-roundtrip-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("C1: adapter JSON round-trip integration", () => {
  test("mock agent outputs JSON, CLI parses it and updates thread head in CAS", async () => {
    // 1. Set up CAS store with workflow, start node, and output schema
    const casDir = join(tmpDir, "cas");
    await mkdir(casDir, { recursive: true });
    const store = createFsStore(casDir);
    const schemas = await registerUwfSchemas(store);

    const outputSchemaHash = await putSchema(store, OUTPUT_SCHEMA);

    const workflowHash = await store.put(schemas.workflow, {
      name: "test-roundtrip",
      description: "roundtrip integration test",
      roles: {
        worker: {
          description: "Worker role",
          goal: "Do work",
          capabilities: [],
          procedure: "work",
          output: "result",
          frontmatter: outputSchemaHash,
        },
      },
      graph: {
        $START: { _: { role: "worker", prompt: "Do the work", location: null } },
        worker: { done: { role: "$END", prompt: "completed", location: null } },
      },
    });

    const startHash = await store.put(schemas.startNode, {
      workflow: workflowHash,
      prompt: "Test round-trip task",
    });

    process.env.UNCAGED_CAS_DIR = casDir;

    const threadId = "01ROUNDTRIPTEST0000000000" as ThreadId;
    await seedThreads(tmpDir, { [threadId]: startHash });

    // 2. Pre-create CAS nodes that the mock agent would produce
    const outputHash = await store.put(outputSchemaHash, {
      $status: "done",
      result: "test-ok",
    });

    // Use text schema for detail (simple placeholder)
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
      edgePrompt: "Do the work",
      startedAtMs,
      completedAtMs,
      cwd: tmpDir,
    });

    // 3. Create a minimal mock agent shell script that just outputs JSON
    //    The step node is already in CAS — the agent just needs to print the JSON line
    const mockAgentPath = join(tmpDir, "mock-agent.sh");
    const adapterJson = JSON.stringify({
      stepHash,
      detailHash,
      role: "worker",
      frontmatter: { $status: "done", result: "test-ok" },
      body: "",
      startedAtMs,
      completedAtMs,
    });
    await writeFile(mockAgentPath, `#!/bin/sh\necho '${adapterJson}'\n`, { mode: 0o755 });

    // 4. Write config.yaml
    const configPath = join(tmpDir, "config.yaml");
    await writeFile(
      configPath,
      `defaultAgent: uwf-hermes\ndefaultModel: test-model\nagentOverrides: null\nagents: {}\nproviders: {}\nmodels: {}\n`,
    );

    // 5. Run CLI with agent override pointing to our mock
    const cliPath = join(import.meta.dirname, "..", "cli.js");
    let stdout: string;
    let stderr: string;
    let exitCode: number;

    try {
      stdout = execFileSync(
        "bun",
        ["run", cliPath, "thread", "exec", threadId, "--agent", mockAgentPath],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            WORKFLOW_STORAGE_ROOT: tmpDir,
            UNCAGED_CAS_DIR: casDir,
          },
          cwd: tmpDir,
          timeout: 30000,
        },
      );
      stderr = "";
      exitCode = 0;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        status?: number;
      };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      exitCode = err.status ?? 1;
    }

    // 6. Verify
    if (exitCode !== 0) {
      throw new Error(`CLI exited with code ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }

    // Parse CLI output
    const cliOutput = JSON.parse(stdout.trim());
    expect(cliOutput).toHaveProperty("thread", threadId);
    expect(cliOutput).toHaveProperty("head", stepHash);
    expect(cliOutput.head).toMatch(/^[0-9A-HJ-NP-TV-Z]{13}$/);

    // Verify the CAS step node exists and has correct metadata
    const storeAfter = createFsStore(casDir);
    const stepNode = storeAfter.get(cliOutput.head as CasRef);
    expect(stepNode).not.toBeNull();

    const payload = stepNode!.payload as StepNodePayload;
    expect(payload.role).toBe("worker");
    expect(payload.agent).toBe("uwf-mock");
    expect(payload.startedAtMs).toBe(1716600000000);
    expect(payload.completedAtMs).toBe(1716600001500);
    expect(payload.output).toBe(outputHash);
    expect(payload.detail).toBe(detailHash);
  });
});
