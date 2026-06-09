import type { Usage } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";

import { mergeUsage } from "../src/run.js";

describe("mergeUsage", () => {
  const primary: Usage = {
    turns: 100,
    inputTokens: 50_000,
    outputTokens: 20_000,
    duration: 330,
  };

  const retry: Usage = {
    turns: 1,
    inputTokens: 2_000,
    outputTokens: 500,
    duration: 36,
  };

  test("sums all fields from two non-null Usage records", () => {
    const result = mergeUsage(primary, retry);
    expect(result).toEqual({
      turns: 101,
      inputTokens: 52_000,
      outputTokens: 20_500,
      duration: 366,
    });
  });

  test("returns b when a is null", () => {
    expect(mergeUsage(null, retry)).toEqual(retry);
  });

  test("returns a when b is null", () => {
    expect(mergeUsage(primary, null)).toEqual(primary);
  });

  test("returns null when both are null", () => {
    expect(mergeUsage(null, null)).toBeNull();
  });

  test("accumulates across multiple retries", () => {
    const retry2: Usage = {
      turns: 1,
      inputTokens: 1_800,
      outputTokens: 400,
      duration: 28,
    };
    const afterFirst = mergeUsage(primary, retry);
    const afterSecond = mergeUsage(afterFirst, retry2);
    expect(afterSecond).toEqual({
      turns: 102,
      inputTokens: 53_800,
      outputTokens: 20_900,
      duration: 394,
    });
  });
});
