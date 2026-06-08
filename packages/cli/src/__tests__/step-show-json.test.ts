import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, type Hash, type JSONSchema, putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, StepNodePayload } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdStepShow } from "../commands/step.js";
import { formatOutput } from "../format.js";
import { registerUwfSchemas } from "../schemas.js";

const TURN_SCHEMA: JSONSchema = {
  title: "test-turn",
  type: "object",
  required: ["index", "role", "content"],
  properties: {
    index: { type: "integer" },
    role: { type: "string", enum: ["assistant", "tool"] },
    content: { type: "string" },
    toolCalls: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            required: ["name", "args"],
            properties: {
              name: { type: "string" },
              args: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        { type: "null" },
      ],
    },
  },
  additionalProperties: false,
};

const DETAIL_SCHEMA: JSONSchema = {
  title: "test-detail",
  type: "object",
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      items: { type: "string", format: "ocas_ref" },
    },
  },
  additionalProperties: false,
};

type TestSetup = {
  store: Awaited<ReturnType<typeof openStore>>;
  schemas: {
    workflow: Hash;
    startNode: Hash;
    stepNode: Hash;
    text: Hash;
  };
  turnType: Hash;
  detailType: Hash;
};

async function setupTest(casDir: string): Promise<TestSetup> {
  const store = await openStore(casDir);
  await bootstrap(store);
  const schemas = await registerUwfSchemas(store);
  const [turnType, detailType] = await Promise.all([
    putSchema(store, TURN_SCHEMA),
    putSchema(store, DETAIL_SCHEMA),
  ]);
  return { store, schemas, turnType, detailType };
}

async function createTestStep(
  setup: TestSetup,
  turnPayloads: Array<{
    index: number;
    role: string;
    content: string;
    toolCalls: Array<{ name: string; args: string }> | null;
  }>,
): Promise<CasRef> {
  const { store, schemas, turnType, detailType } = setup;

  // Create turn nodes
  const turnHashes: CasRef[] = [];
  for (const payload of turnPayloads) {
    const turnHash = await store.cas.put(turnType, payload);
    turnHashes.push(turnHash);
  }

  // Create detail node
  const detailHash = await store.cas.put(detailType, { turns: turnHashes });

  // Create dummy start node
  const startHash = await store.cas.put(schemas.startNode, {
    workflow: "0000000000000" as CasRef,
    prompt: "test prompt",
    cwd: "/tmp",
  });

  // Create dummy output node
  const outputHash = await store.cas.put(schemas.text, { $status: "done" });

  // Create step node
  const stepPayload: StepNodePayload = {
    prev: null,
    start: startHash,
    role: "test-role",
    agent: "test-agent",
    output: outputHash,
    detail: detailHash,
    edgePrompt: "",
    startedAtMs: Date.now(),
    completedAtMs: Date.now() + 1000,
    assembledPrompt: null,
    cwd: "/tmp",
    usage: null,
    previousAttempts: null,
  };
  return store.cas.put(schemas.stepNode, stepPayload);
}

describe("cmdStepShow JSON serialization", () => {
  let testDir: string;
  let casDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "uwf-test-"));
    casDir = join(testDir, "cas");
    await mkdir(casDir, { recursive: true });
    originalEnv = process.env.OCAS_HOME;
    process.env.OCAS_HOME = casDir;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.OCAS_HOME;
    } else {
      process.env.OCAS_HOME = originalEnv;
    }
  });

  test("escapes newlines in tool call args", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "Running command",
        toolCalls: [
          {
            name: "Bash",
            args: "echo 'line1'\necho 'line2'",
          },
        ],
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    expect(jsonOutput).toContain("\\n");

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.turns[0].toolCalls[0].args).toContain("\n");
  });

  test("escapes tabs in tool call args", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            name: "Bash",
            args: "cat <<EOF\nfield1\tfield2\tfield3\nEOF",
          },
        ],
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    expect(jsonOutput).toContain("\\t");
  });

  test("escapes carriage returns", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "Committing changes",
        toolCalls: [
          {
            name: "Bash",
            args: 'git commit -m "First line\r\nSecond line"',
          },
        ],
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    expect(jsonOutput).toContain("\\r\\n");
  });

  test("escapes backslashes and quotes", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            name: "Bash",
            args: 'echo "He said \\"hello\\""',
          },
        ],
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.turns).toBeDefined();
  });

  test("handles Unicode control characters", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            name: "Bash",
            args: "echo '\u0001\u001F'",
          },
        ],
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
  });

  test("handles nested CAS refs with control characters", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "First turn\nwith newline",
        toolCalls: [
          {
            name: "Bash",
            args: "cmd1\nline2",
          },
        ],
      },
      {
        index: 1,
        role: "assistant",
        content: "Second turn\twith tab",
        toolCalls: null,
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.turns).toHaveLength(2);
  });

  test("YAML output format is unaffected", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "Running command",
        toolCalls: [
          {
            name: "Bash",
            args: "echo 'line1'\necho 'line2'",
          },
        ],
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const yamlOutput = formatOutput(result, "yaml");

    expect(yamlOutput).toContain("turns:");
    expect(yamlOutput.length).toBeGreaterThan(0);
  });

  test("handles empty and null values", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [
      {
        index: 0,
        role: "assistant",
        content: "",
        toolCalls: null,
      },
    ]);

    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.turns).toBeDefined();
  });

  test("handles large step with multiple tool calls", async () => {
    const setup = await setupTest(casDir);

    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({
        index: i,
        role: "assistant" as const,
        content: `Turn ${i}\nwith newline`,
        toolCalls: [
          {
            name: "Bash",
            args: `command${i}\nline2\tfield${i}`,
          },
          {
            name: "Read",
            args: `/path/to/file${i}`,
          },
        ],
      });
    }

    const stepHash = await createTestStep(setup, turns);

    const startTime = Date.now();
    const result = await cmdStepShow(testDir, stepHash);
    const jsonOutput = formatOutput(result, "json");
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(2000);
    expect(() => JSON.parse(jsonOutput)).not.toThrow();

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.turns).toHaveLength(25);
  });
});
