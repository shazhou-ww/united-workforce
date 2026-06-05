import { describe, expect, test } from "vitest";
import type { AcpUsage } from "../src/acp-client.js";
import { buildUsage, snapshotTurns } from "../src/hermes.js";
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

describe("snapshotTurns", () => {
  test("returns zero for null session", () => {
    const result = snapshotTurns(null);
    expect(result).toEqual({ turns: 0 });
  });

  test("returns zero for empty session", () => {
    const result = snapshotTurns(makeSession());
    expect(result).toEqual({ turns: 0 });
  });

  test("counts assistant messages as turns", () => {
    const result = snapshotTurns(
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
    expect(result).toEqual({ turns: 2 });
  });

  test("ignores non-assistant messages for turn count", () => {
    const result = snapshotTurns(
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

describe("buildUsage", () => {
  const acpUsage: AcpUsage = { inputTokens: 5000, outputTokens: 2000, totalTokens: 7000 };

  test("first visit: tokens from ACP, turns from DB delta", () => {
    const beforeTurns = { turns: 0 };
    const afterTurns = { turns: 3 };
    const result = buildUsage(acpUsage, beforeTurns, afterTurns, 12.5);
    expect(result).toEqual({
      turns: 3,
      inputTokens: 5000,
      outputTokens: 2000,
      duration: 13,
    });
  });

  test("re-entry: turn delta computed correctly, tokens from ACP", () => {
    const beforeTurns = { turns: 2 };
    const afterTurns = { turns: 4 };
    const acpDelta: AcpUsage = { inputTokens: 8000, outputTokens: 3500, totalTokens: 11500 };
    const result = buildUsage(acpDelta, beforeTurns, afterTurns, 7.3);
    expect(result).toEqual({
      turns: 2,
      inputTokens: 8000,
      outputTokens: 3500,
      duration: 7,
    });
  });

  test("floors negative turn deltas at 0, then defaults to 1", () => {
    const beforeTurns = { turns: 5 };
    const afterTurns = { turns: 3 };
    const result = buildUsage(acpUsage, beforeTurns, afterTurns, 1.0);
    // turns would be negative (-2), floored to 0, then || 1 gives 1
    expect(result.turns).toBe(1);
  });

  test("zero turns delta defaults to 1 (at least one turn happened)", () => {
    const beforeTurns = { turns: 3 };
    const afterTurns = { turns: 3 };
    const result = buildUsage(acpUsage, beforeTurns, afterTurns, 5.0);
    // turns delta is 0, || 1 gives 1
    expect(result.turns).toBe(1);
  });

  test("null ACP usage yields zero tokens", () => {
    const beforeTurns = { turns: 0 };
    const afterTurns = { turns: 2 };
    const result = buildUsage(null, beforeTurns, afterTurns, 10.0);
    expect(result).toEqual({
      turns: 2,
      inputTokens: 0,
      outputTokens: 0,
      duration: 10,
    });
  });

  test("duration is rounded", () => {
    const beforeTurns = { turns: 0 };
    const afterTurns = { turns: 1 };
    expect(buildUsage(acpUsage, beforeTurns, afterTurns, 3.7).duration).toBe(4);
    expect(buildUsage(acpUsage, beforeTurns, afterTurns, 3.2).duration).toBe(3);
    expect(buildUsage(acpUsage, beforeTurns, afterTurns, 0.0).duration).toBe(0);
  });
});
