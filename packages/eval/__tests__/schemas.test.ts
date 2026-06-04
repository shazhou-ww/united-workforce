import { describe, expect, test } from "vitest";
import {
  EVAL_JUDGE_FRONTMATTER_SCHEMA,
  EVAL_JUDGE_HALLUCINATION_SCHEMA,
  EVAL_JUDGE_TOKEN_STATS_SCHEMA,
  EVAL_JUDGE_UPSTREAM_SCHEMA,
  EVAL_RUN_SCHEMA,
} from "../src/storage/index.js";

describe("OCAS schema definitions", () => {
  test("eval-run schema has correct title and required fields", () => {
    expect(EVAL_RUN_SCHEMA.title).toBe("@uwf/eval-run");
    const required = EVAL_RUN_SCHEMA.required as string[];
    expect(required).toContain("task");
    expect(required).toContain("config");
    expect(required).toContain("threadId");
    expect(required).toContain("judges");
    expect(required).toContain("overall");
    expect(required).toContain("timestamp");
  });

  test("frontmatter judge schema has correct title", () => {
    expect(EVAL_JUDGE_FRONTMATTER_SCHEMA.title).toBe("@uwf/eval-judge-frontmatter");
    const required = EVAL_JUDGE_FRONTMATTER_SCHEMA.required as string[];
    expect(required).toContain("stepsTotal");
    expect(required).toContain("stepsValid");
    expect(required).toContain("invalidSteps");
  });

  test("upstream judge schema has correct title", () => {
    expect(EVAL_JUDGE_UPSTREAM_SCHEMA.title).toBe("@uwf/eval-judge-upstream");
    const required = EVAL_JUDGE_UPSTREAM_SCHEMA.required as string[];
    expect(required).toContain("perStep");
  });

  test("hallucination judge schema has correct title", () => {
    expect(EVAL_JUDGE_HALLUCINATION_SCHEMA.title).toBe("@uwf/eval-judge-hallucination");
    const required = EVAL_JUDGE_HALLUCINATION_SCHEMA.required as string[];
    expect(required).toContain("perStep");
  });

  test("token-stats judge schema has correct title", () => {
    expect(EVAL_JUDGE_TOKEN_STATS_SCHEMA.title).toBe("@uwf/eval-judge-token-stats");
    const required = EVAL_JUDGE_TOKEN_STATS_SCHEMA.required as string[];
    expect(required).toContain("totalInput");
    expect(required).toContain("totalOutput");
    expect(required).toContain("totalTurns");
    expect(required).toContain("perStep");
  });

  test("all schemas have type object at root", () => {
    const schemas = [
      EVAL_RUN_SCHEMA,
      EVAL_JUDGE_FRONTMATTER_SCHEMA,
      EVAL_JUDGE_UPSTREAM_SCHEMA,
      EVAL_JUDGE_HALLUCINATION_SCHEMA,
      EVAL_JUDGE_TOKEN_STATS_SCHEMA,
    ];
    for (const s of schemas) {
      expect(s.type).toBe("object");
    }
  });
});
