import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, StepEntry, Usage } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildStepEntry, sumStepEntryUsage } from "../commands/step.js";
import { createUwfStore, type UwfStore } from "../store.js";

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-build-step-entry-"));
  originalEnv = process.env.OCAS_HOME;
  process.env.OCAS_HOME = join(tmpDir, "cas");
  await mkdir(process.env.OCAS_HOME, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = originalEnv;
  }
});

type PutStepOptions = {
  startedAtMs: number;
  completedAtMs: number;
  usage: Usage | null;
  previousAttempts: CasRef[] | null;
};

async function setupStore(): Promise<{ uwf: UwfStore; startHash: CasRef }> {
  const uwf = await createUwfStore(tmpDir);
  const workflowHash = (await uwf.store.cas.put(uwf.schemas.workflow, {
    name: "test-wf",
    description: "desc",
    roles: {},
    graph: {},
  })) as CasRef;
  const startHash = (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "task",
    cwd: "/tmp",
  })) as CasRef;
  return { uwf, startHash };
}

async function putStep(uwf: UwfStore, startHash: CasRef, options: PutStepOptions): Promise<CasRef> {
  const outputHash = (await uwf.store.cas.put(uwf.schemas.text, "output text")) as CasRef;
  const detailHash = (await uwf.store.cas.put(uwf.schemas.text, "detail text")) as CasRef;
  return (await uwf.store.cas.put(uwf.schemas.stepNode, {
    start: startHash,
    prev: null,
    role: "planner",
    output: outputHash,
    detail: detailHash,
    agent: "uwf-mock",
    edgePrompt: "",
    startedAtMs: options.startedAtMs,
    completedAtMs: options.completedAtMs,
    cwd: "/tmp",
    assembledPrompt: null,
    usage: options.usage,
    previousAttempts: options.previousAttempts,
  })) as CasRef;
}

const usage = (
  turns: number,
  inputTokens: number,
  outputTokens: number,
  duration: number,
): Usage => ({
  turns,
  inputTokens,
  outputTokens,
  duration,
});

describe("buildStepEntry", () => {
  test("returns null for a non-StepNode hash", async () => {
    const { uwf } = await setupStore();
    const textHash = (await uwf.store.cas.put(uwf.schemas.text, "not a step")) as CasRef;
    expect(buildStepEntry(uwf, textHash)).toBeNull();
    expect(buildStepEntry(uwf, "MISSING000000" as CasRef)).toBeNull();
  });

  test("builds an entry with no previousAttempts and computes durationMs", async () => {
    const { uwf, startHash } = await setupStore();
    const stepHash = await putStep(uwf, startHash, {
      startedAtMs: 1_000,
      completedAtMs: 4_500,
      usage: usage(2, 100, 50, 3.5),
      previousAttempts: null,
    });

    const entry = buildStepEntry(uwf, stepHash);
    expect(entry).not.toBeNull();
    expect(entry?.hash).toBe(stepHash);
    expect(entry?.role).toBe("planner");
    expect(entry?.durationMs).toBe(3_500);
    expect(entry?.usage).toEqual(usage(2, 100, 50, 3.5));
    expect(entry?.previousAttempts).toBeNull();
  });

  test("recursively builds nested previousAttempts", async () => {
    const { uwf, startHash } = await setupStore();
    const first = await putStep(uwf, startHash, {
      startedAtMs: 0,
      completedAtMs: 100,
      usage: usage(1, 10, 5, 0.1),
      previousAttempts: null,
    });
    const second = await putStep(uwf, startHash, {
      startedAtMs: 100,
      completedAtMs: 300,
      usage: usage(1, 20, 10, 0.2),
      previousAttempts: [first],
    });
    const success = await putStep(uwf, startHash, {
      startedAtMs: 300,
      completedAtMs: 600,
      usage: usage(3, 30, 15, 0.3),
      previousAttempts: [second],
    });

    const entry = buildStepEntry(uwf, success);
    expect(entry?.previousAttempts).toHaveLength(1);
    const nested = entry?.previousAttempts?.[0];
    expect(nested?.hash).toBe(second);
    expect(nested?.previousAttempts).toHaveLength(1);
    expect(nested?.previousAttempts?.[0]?.hash).toBe(first);
    expect(nested?.previousAttempts?.[0]?.previousAttempts).toBeNull();
  });

  test("skips previousAttempts refs that do not resolve to a StepNode", async () => {
    const { uwf, startHash } = await setupStore();
    const success = await putStep(uwf, startHash, {
      startedAtMs: 0,
      completedAtMs: 100,
      usage: null,
      previousAttempts: ["DEADBEEF00000" as CasRef],
    });

    const entry = buildStepEntry(uwf, success);
    expect(entry).not.toBeNull();
    // The unresolvable ref is skipped, leaving no valid nested attempts.
    expect(entry?.previousAttempts).toBeNull();
  });
});

describe("sumStepEntryUsage", () => {
  function entryWith(u: Usage | null, previousAttempts: StepEntry[] | null): StepEntry {
    return {
      hash: "STEP000000000" as CasRef,
      role: "planner",
      output: {},
      detail: "DETAIL0000000" as CasRef,
      agent: "uwf-mock",
      timestamp: 0,
      durationMs: 0,
      usage: u,
      previousAttempts,
    };
  }

  test("returns zeros when usage is null and there are no attempts", () => {
    expect(sumStepEntryUsage(entryWith(null, null))).toEqual({
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      duration: 0,
    });
  });

  test("aggregates usage across nested previousAttempts", () => {
    const inner = entryWith(usage(1, 10, 5, 0.1), null);
    const middle = entryWith(usage(2, 20, 10, 0.2), [inner]);
    const root = entryWith(usage(3, 30, 15, 0.3), [middle]);

    expect(sumStepEntryUsage(root)).toEqual({
      turns: 6,
      inputTokens: 60,
      outputTokens: 30,
      duration: expect.closeTo(0.6, 5),
    });
  });

  test("treats null usage in nested attempts as zero", () => {
    const inner = entryWith(null, null);
    const root = entryWith(usage(2, 20, 10, 0.5), [inner]);

    expect(sumStepEntryUsage(root)).toEqual({
      turns: 2,
      inputTokens: 20,
      outputTokens: 10,
      duration: 0.5,
    });
  });
});
