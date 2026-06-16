import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, type Hash, type JSONSchema, putSchema } from "@ocas/core";
import { openStore } from "@ocas/fs";
import type { CasRef, StepNodePayload } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cmdStepShow } from "../commands/step.js";
import { writeEnvelope } from "../format.js";
import { toStepDetailPayload } from "../output-mappers.js";
import { registerUwfSchemas } from "../schemas.js";
import { createUwfStore } from "../store.js";

/**
 * Issue #403 — regression guard for the `step show` **text** path.
 *
 * PR #394 added the `--- Content ---` turn block (plus `Usage` / `Turns`) to
 * `STEP_DETAIL_TEMPLATE` and the `toStepDetailPayload` mapper flattens
 * `detail.turns` into a top-level `turns` array — but no test asserted that the
 * rendered text actually contains the turn bodies. A stale build (e.g. the
 * published `protocol@0.4.0`) or an accidental retarget to `detail.turns` would
 * go undetected.
 *
 * This exercises the full path
 *   cmdStepShow → toStepDetailPayload → writeEnvelope(text) → renderEnvelopeText
 * and asserts the rendered text contains `--- Content ---`, each turn's content
 * substring, and the `Turns   N` line. The sibling JSON contract lives in
 * `step-show-json.test.ts`; the protocol-level template invariant lives in
 * `packages/protocol/src/__tests__/output-templates-step-detail.test.ts`.
 */

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
  schemas: Awaited<ReturnType<typeof registerUwfSchemas>>;
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
  usage: StepNodePayload["usage"],
): Promise<CasRef> {
  const { store, schemas, turnType, detailType } = setup;

  const turnHashes: CasRef[] = [];
  for (const payload of turnPayloads) {
    turnHashes.push(await store.cas.put(turnType, payload));
  }

  const detailHash = await store.cas.put(detailType, { turns: turnHashes });
  const startHash = await store.cas.put(schemas.startNode, {
    workflow: "0000000000000" as CasRef,
    prompt: "test prompt",
    cwd: "/tmp",
  });
  const outputHash = await store.cas.put(schemas.text, { $status: "reviewed" });

  const stepPayload: StepNodePayload = {
    prev: null,
    start: startHash,
    role: "reviewer",
    agent: "claude-code",
    output: outputHash,
    detail: detailHash,
    edgePrompt: "",
    startedAtMs: 1_000_000,
    completedAtMs: 1_137_400,
    assembledPrompt: null,
    cwd: "/tmp",
    usage,
    previousAttempts: null,
  };
  return store.cas.put(schemas.stepNode, stepPayload);
}

/** Capture everything written to `process.stdout` while `fn` runs. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const buf: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ): boolean => {
    buf.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return buf.join("");
}

describe("cmdStepShow text rendering (issue #403)", () => {
  let testDir: string;
  let casDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "uwf-step-show-text-"));
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
    vi.restoreAllMocks();
  });

  test("renders the --- Content --- block with each turn's role and content", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(
      setup,
      [
        { index: 0, role: "assistant", content: "first turn body", toolCalls: null },
        { index: 1, role: "assistant", content: "second turn body", toolCalls: null },
      ],
      { turns: 9, inputTokens: 38612, outputTokens: 10584, duration: 137400 },
    );

    const detail = await cmdStepShow(testDir, stepHash);
    const uwf = await createUwfStore(testDir);
    const out = await captureStdout(async () =>
      writeEnvelope(toStepDetailPayload(stepHash, detail), "step-detail", {
        format: "text",
        store: uwf.store,
        schemas: uwf.schemas,
      }),
    );

    // Metadata header
    expect(out).toContain(`Step    ${stepHash}`);
    expect(out).toContain("Role    reviewer");
    expect(out).toContain("Agent   claude-code");
    expect(out).toContain("Status  reviewed");
    expect(out).toContain("Duration 137.4s");
    expect(out).toContain("Usage   38612 in / 10584 out / 9 turns");

    // Turn-content block — the headline regression assertion
    expect(out).toContain("Turns   2");
    expect(out).toContain("--- Content ---");
    expect(out).toContain("[assistant] first turn body");
    expect(out).toContain("[assistant] second turn body");

    // No JSON envelope leakage and a single trailing newline
    expect(out).not.toContain('"type"');
    expect(out).not.toContain("undefined");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  test("omits the Content block for a step with zero turns, without throwing", async () => {
    const setup = await setupTest(casDir);
    const stepHash = await createTestStep(setup, [], null);

    const detail = await cmdStepShow(testDir, stepHash);
    const uwf = await createUwfStore(testDir);
    const out = await captureStdout(async () =>
      writeEnvelope(toStepDetailPayload(stepHash, detail), "step-detail", {
        format: "text",
        store: uwf.store,
        schemas: uwf.schemas,
      }),
    );

    expect(out).toContain("Role    reviewer");
    expect(out).not.toContain("--- Content ---");
    expect(out).not.toMatch(/^Turns\s/m);
    expect(out).not.toContain("undefined");
  });
});
