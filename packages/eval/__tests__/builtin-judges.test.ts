import type { StepEntry } from "@united-workforce/protocol";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  runFrontmatterJudge,
  runHallucinationJudge,
  runTokenStatsJudge,
  runUpstreamJudge,
} from "../src/judge/builtin/index.js";

// Mock the shared read-steps helper so the judges never shell out to `uwf`.
vi.mock("../src/judge/builtin/read-steps.js", () => ({
  readThreadSteps: vi.fn(),
}));

import { readThreadSteps } from "../src/judge/builtin/read-steps.js";

const mockedReadSteps = vi.mocked(readThreadSteps);

function makeStep(overrides: Partial<StepEntry>): StepEntry {
  return {
    hash: "HASH000000000",
    role: "worker",
    output: "---\n$status: done\n---\n\nbody",
    detail: "DETAIL0000000",
    agent: "hermes",
    timestamp: 0,
    durationMs: 0,
    usage: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockedReadSteps.mockReset();
});

describe("frontmatter-compliance judge", () => {
  test("all steps have valid frontmatter → score 1.0", async () => {
    mockedReadSteps.mockReturnValue([
      makeStep({ role: "a", output: "---\n$status: done\n---\n\nwork" }),
      makeStep({ role: "b", output: "---\n$status: needs_input\n---\nmore" }),
    ]);

    const result = await runFrontmatterJudge("T1");
    const data = result.data as { stepsTotal: number; stepsValid: number; invalidSteps: unknown[] };

    expect(result.score).toBe(1.0);
    expect(data.stepsTotal).toBe(2);
    expect(data.stepsValid).toBe(2);
    expect(data.invalidSteps).toHaveLength(0);
  });

  test("some steps missing $status → partial score", async () => {
    mockedReadSteps.mockReturnValue([
      makeStep({ role: "a", output: "---\n$status: done\n---\nok" }),
      makeStep({ role: "b", output: "---\nfoo: bar\n---\nmissing status" }),
      makeStep({ role: "c", output: "no frontmatter at all" }),
    ]);

    const result = await runFrontmatterJudge("T2");
    const data = result.data as {
      stepsTotal: number;
      stepsValid: number;
      invalidSteps: Array<{ stepIndex: number; role: string; errors: string[] }>;
    };

    expect(result.score).toBeCloseTo(1 / 3, 10);
    expect(data.stepsTotal).toBe(3);
    expect(data.stepsValid).toBe(1);
    expect(data.invalidSteps).toHaveLength(2);
    expect(data.invalidSteps[0]).toMatchObject({ stepIndex: 1, role: "b" });
    expect(data.invalidSteps[1]).toMatchObject({ stepIndex: 2, role: "c" });
  });

  test("no steps → score 0 (0/0 edge case)", async () => {
    mockedReadSteps.mockReturnValue([]);

    const result = await runFrontmatterJudge("T3");
    const data = result.data as { stepsTotal: number; stepsValid: number; invalidSteps: unknown[] };

    expect(result.score).toBe(0);
    expect(data.stepsTotal).toBe(0);
    expect(data.stepsValid).toBe(0);
    expect(data.invalidSteps).toHaveLength(0);
  });

  test("empty-string $status counts as invalid", async () => {
    mockedReadSteps.mockReturnValue([makeStep({ role: "a", output: '---\n$status: ""\n---\nx' })]);

    const result = await runFrontmatterJudge("T4");
    expect(result.score).toBe(0);
  });
});

describe("token-stats judge", () => {
  test("steps with usage → sums correctly", async () => {
    mockedReadSteps.mockReturnValue([
      makeStep({
        role: "a",
        usage: { turns: 2, inputTokens: 100, outputTokens: 50, duration: 1.5 },
      }),
      makeStep({
        role: "b",
        usage: { turns: 3, inputTokens: 200, outputTokens: 75, duration: 2.0 },
      }),
    ]);

    const result = await runTokenStatsJudge("T1");
    const data = result.data as {
      totalInput: number;
      totalOutput: number;
      totalTurns: number;
      perStep: Array<{ role: string; inputTokens: number; outputTokens: number; turns: number }>;
    };

    expect(result.score).toBe(1.0);
    expect(data.totalInput).toBe(300);
    expect(data.totalOutput).toBe(125);
    expect(data.totalTurns).toBe(5);
    expect(data.perStep).toHaveLength(2);
    expect(data.perStep[0]).toEqual({
      role: "a",
      inputTokens: 100,
      outputTokens: 50,
      turns: 2,
      duration: 1.5,
    });
  });

  test("steps with null usage → zeros", async () => {
    mockedReadSteps.mockReturnValue([
      makeStep({ role: "a", usage: null }),
      makeStep({ role: "b", usage: null }),
    ]);

    const result = await runTokenStatsJudge("T2");
    const data = result.data as {
      totalInput: number;
      totalOutput: number;
      totalTurns: number;
      perStep: Array<{
        inputTokens: number;
        outputTokens: number;
        turns: number;
        duration: number;
      }>;
    };

    expect(result.score).toBe(1.0);
    expect(data.totalInput).toBe(0);
    expect(data.totalOutput).toBe(0);
    expect(data.totalTurns).toBe(0);
    expect(data.perStep[0]).toEqual({
      role: "a",
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      duration: 0,
    });
  });

  test("empty steps → all zeros, score 1.0", async () => {
    mockedReadSteps.mockReturnValue([]);

    const result = await runTokenStatsJudge("T3");
    const data = result.data as {
      totalInput: number;
      totalOutput: number;
      totalTurns: number;
      perStep: unknown[];
    };

    expect(result.score).toBe(1.0);
    expect(data.totalInput).toBe(0);
    expect(data.totalOutput).toBe(0);
    expect(data.totalTurns).toBe(0);
    expect(data.perStep).toHaveLength(0);
  });
});

describe("LLM-as-judge stubs", () => {
  test("upstream-consumption returns a stub", async () => {
    const result = await runUpstreamJudge("T1");
    expect(result.score).toBe(0);
    expect(result.data).toEqual({ perStep: [] });
    expect(result.schema.title).toBe("@uwf/eval-judge-upstream");
  });

  test("hallucination returns a stub", async () => {
    const result = await runHallucinationJudge("T1");
    expect(result.score).toBe(0);
    expect(result.data).toEqual({ perStep: [] });
    expect(result.schema.title).toBe("@uwf/eval-judge-hallucination");
  });
});
