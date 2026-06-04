import { bootstrap, createMemoryStore } from "@ocas/core";
import { describe, expect, test } from "vitest";
import type { JudgeRunner } from "../src/runner/index.js";
import { collect, computeOverall } from "../src/runner/index.js";
import type { EvalRunConfig, EvalStore } from "../src/storage/index.js";
import type { JudgeEntry, TaskManifest } from "../src/task/index.js";

function makeJudge(name: string, weight: number, builtin: boolean): JudgeEntry {
  return {
    name,
    weight,
    builtin,
    entry: builtin ? null : `dist/judges/${name}.js`,
    schema: null,
  };
}

function makeManifest(judges: JudgeEntry[]): TaskManifest {
  return {
    name: "fix-off-by-one",
    description: "test task",
    workflow: "solve-issue",
    prompt: "Fix the bug",
    limits: { maxSteps: 10, timeoutMinutes: 30 },
    judges,
  };
}

function makeEvalStore(): EvalStore {
  const store = createMemoryStore();
  bootstrap(store);
  return { store, varStore: store.var };
}

const CONFIG: EvalRunConfig = {
  agent: "hermes",
  model: "claude-sonnet-4",
  engineVersion: "test",
};

/** Returns a fixed score per judge name. */
function scriptedRunner(scores: Record<string, number>): JudgeRunner {
  return async (_taskDir, _workDir, _threadId, judge) => ({
    score: scores[judge.name] ?? 0,
    data: { judged: judge.name },
    schema: { type: "object" },
  });
}

describe("computeOverall", () => {
  test("computes the weighted average correctly", () => {
    const overall = computeOverall([
      { score: 0.8, weight: 0.3 },
      { score: 0.6, weight: 0.3 },
      { score: 1.0, weight: 0.4 },
    ]);
    // 0.24 + 0.18 + 0.4 = 0.82
    expect(overall).toBeCloseTo(0.82, 10);
  });

  test("a weight-0 judge does not affect the result", () => {
    const withInformational = computeOverall([
      { score: 1.0, weight: 1.0 },
      { score: 0.0, weight: 0.0 },
    ]);
    expect(withInformational).toBe(1.0);
  });

  test("returns 0 when total weight is 0", () => {
    expect(computeOverall([{ score: 0.5, weight: 0 }])).toBe(0);
  });
});

describe("collect", () => {
  test("computes weighted score correctly across judges", async () => {
    const evalStore = makeEvalStore();
    const manifest = makeManifest([
      makeJudge("test-pass", 0.6, false),
      makeJudge("code-quality", 0.4, false),
    ]);
    const runJudge = scriptedRunner({ "test-pass": 1.0, "code-quality": 0.5 });

    const result = await collect(
      {
        evalStore,
        taskDir: "/tmp/task",
        workDir: "/tmp/work",
        threadId: "THREAD123",
        manifest,
        config: CONFIG,
      },
      runJudge,
    );

    // 1.0 * 0.6 + 0.5 * 0.4 = 0.8
    expect(result.overall).toBeCloseTo(0.8, 10);
    expect(result.runHash).toBeTruthy();
    expect(result.judges).toHaveLength(2);
    expect(result.judges[0]).toEqual({ name: "test-pass", score: 1.0, weight: 0.6 });

    const latest = evalStore.varStore.list({
      exactName: "@uwf/eval/fix-off-by-one/latest",
    });
    expect(latest[0]?.value).toBe(result.runHash);
  });

  test("handles a judge with weight 0 (informational)", async () => {
    const evalStore = makeEvalStore();
    const manifest = makeManifest([
      makeJudge("test-pass", 1.0, false),
      makeJudge("token-stats", 0, true),
    ]);
    // token-stats is builtin → default runner would score 0; give scripted score
    // that would skew the result if it were counted.
    const runJudge = scriptedRunner({ "test-pass": 0.5, "token-stats": 1.0 });

    const result = await collect(
      {
        evalStore,
        taskDir: "/tmp/task",
        workDir: "/tmp/work",
        threadId: "THREAD123",
        manifest,
        config: CONFIG,
      },
      runJudge,
    );

    // Only test-pass (weight 1.0) counts → overall = 0.5
    expect(result.overall).toBeCloseTo(0.5, 10);
    expect(result.judges).toHaveLength(2);
    const tokenStats = result.judges.find((j) => j.name === "token-stats");
    expect(tokenStats?.weight).toBe(0);
  });

  test("builtin judges are skipped with placeholder score 0", async () => {
    const evalStore = makeEvalStore();
    const manifest = makeManifest([makeJudge("frontmatter-compliance", 1.0, true)]);

    // Use the default runner (no injected runner) → builtin skipped → score 0.
    const result = await collect({
      evalStore,
      taskDir: "/tmp/task",
      workDir: "/tmp/work",
      threadId: "THREAD123",
      manifest,
      config: CONFIG,
    });

    expect(result.overall).toBe(0);
    expect(result.judges[0]).toEqual({
      name: "frontmatter-compliance",
      score: 0,
      weight: 1.0,
    });
  });
});
