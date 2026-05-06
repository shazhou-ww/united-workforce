import { describe, expect, test } from "bun:test";
import { START, type ThreadContext } from "@uncaged/workflow";

import { buildAgentPrompt, createHermesAgent, validateHermesAgentConfig } from "../src/index.js";

function makeCtx(): ThreadContext {
  return {
    start: {
      role: START,
      content: "plan the migration",
      meta: { maxRounds: 8 },
      timestamp: 1,
    },
    steps: [],
  };
}

describe("validateHermesAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateHermesAgentConfig({
      model: null,
      timeout: null,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects negative timeout", () => {
    const r = validateHermesAgentConfig({
      model: null,
      timeout: -5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("timeout");
    }
  });
});

describe("buildAgentPrompt", () => {
  test("includes system and thread start", () => {
    const text = buildAgentPrompt(makeCtx(), "You are a planner.");
    expect(text).toContain("You are a planner.");
    expect(text).toContain("plan the migration");
  });
});

describe("createHermesAgent", () => {
  test("returns an AgentFn", () => {
    const agent = createHermesAgent({
      model: null,
      timeout: null,
    });
    expect(typeof agent).toBe("function");
  });
});
