import { describe, expect, test } from "vitest";
import { computeUsageDelta, snapshotUsage } from "../src/hermes.js";
import type { HermesSessionJson } from "../src/types.js";

function makeSession(overrides: Partial<HermesSessionJson> = {}): HermesSessionJson {
  return {
    session_id: "test-session",
    model: "test-model",
    session_start: "2026-01-01T00:00:00Z",
    messages: [],
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

describe("snapshotUsage", () => {
  test("returns zero snapshot for null session", () => {
    const result = snapshotUsage(null);
    expect(result).toEqual({ turns: 0, inputTokens: 0, outputTokens: 0 });
  });

  test("returns zero snapshot for empty session", () => {
    const result = snapshotUsage(makeSession());
    expect(result).toEqual({ turns: 0, inputTokens: 0, outputTokens: 0 });
  });

  test("counts assistant messages as turns", () => {
    const result = snapshotUsage(
      makeSession({
        messages: [
          { role: "user", content: "hello", reasoning: null, tool_calls: null },
          { role: "assistant", content: "hi", reasoning: null, tool_calls: null },
          { role: "user", content: "do X", reasoning: null, tool_calls: null },
          { role: "tool", content: "result", reasoning: null, tool_calls: null },
          { role: "assistant", content: "done", reasoning: null, tool_calls: null },
        ],
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );
    expect(result).toEqual({ turns: 2, inputTokens: 1000, outputTokens: 500 });
  });

  test("ignores non-assistant messages for turn count", () => {
    const result = snapshotUsage(
      makeSession({
        messages: [
          { role: "user", content: "hello", reasoning: null, tool_calls: null },
          { role: "tool", content: "result", reasoning: null, tool_calls: null },
        ],
      }),
    );
    expect(result.turns).toBe(0);
  });
});

describe("computeUsageDelta", () => {
  test("first visit: before is zero, after has all values", () => {
    const before = { turns: 0, inputTokens: 0, outputTokens: 0 };
    const after = { turns: 3, inputTokens: 5000, outputTokens: 2000 };
    const result = computeUsageDelta(before, after, 12.5);
    expect(result).toEqual({
      turns: 3,
      inputTokens: 5000,
      outputTokens: 2000,
      duration: 13,
    });
  });

  test("re-entry: computes delta correctly", () => {
    const before = { turns: 2, inputTokens: 3000, outputTokens: 1000 };
    const after = { turns: 4, inputTokens: 8000, outputTokens: 3500 };
    const result = computeUsageDelta(before, after, 7.3);
    expect(result).toEqual({
      turns: 2,
      inputTokens: 5000,
      outputTokens: 2500,
      duration: 7,
    });
  });

  test("floors negative deltas at 0 (defensive)", () => {
    const before = { turns: 5, inputTokens: 10000, outputTokens: 5000 };
    const after = { turns: 3, inputTokens: 8000, outputTokens: 4000 };
    const result = computeUsageDelta(before, after, 1.0);
    // turns would be negative (-2), floored to 0, then || 1 gives 1
    expect(result.turns).toBe(1);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  test("zero turns delta defaults to 1 (at least one turn happened)", () => {
    const before = { turns: 3, inputTokens: 1000, outputTokens: 500 };
    const after = { turns: 3, inputTokens: 2000, outputTokens: 1000 };
    const result = computeUsageDelta(before, after, 5.0);
    // turns delta is 0, || 1 gives 1
    expect(result.turns).toBe(1);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
  });

  test("duration is rounded", () => {
    const before = { turns: 0, inputTokens: 0, outputTokens: 0 };
    const after = { turns: 1, inputTokens: 100, outputTokens: 50 };
    expect(computeUsageDelta(before, after, 3.7).duration).toBe(4);
    expect(computeUsageDelta(before, after, 3.2).duration).toBe(3);
    expect(computeUsageDelta(before, after, 0.0).duration).toBe(0);
  });
});
