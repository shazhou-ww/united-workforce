import { describe, expect, test } from "bun:test";
import { START, type ThreadContext } from "@uncaged/workflow";

import { buildAgentPrompt, createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

function makeCtx(): ThreadContext {
  return {
    start: {
      role: START,
      content: "user task",
      meta: { maxRounds: 5 },
      timestamp: 1,
    },
    steps: [
      {
        role: "coder",
        content: "first draft",
        meta: {},
        timestamp: 2,
      },
    ],
  };
}

describe("validateCursorAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateCursorAgentConfig({
      workdir: "/tmp",
      model: null,
      timeout: null,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects empty workdir", () => {
    const r = validateCursorAgentConfig({
      workdir: "   ",
      model: null,
      timeout: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("workdir");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateCursorAgentConfig({
      workdir: "/tmp",
      model: null,
      timeout: -1,
    });
    expect(r.ok).toBe(false);
  });
});

describe("buildAgentPrompt", () => {
  test("includes system prompt, start, and steps", () => {
    const text = buildAgentPrompt(makeCtx(), "Be helpful.");
    expect(text).toContain("Be helpful.");
    expect(text).toContain("user task");
    expect(text).toContain("coder");
    expect(text).toContain("first draft");
  });
});

describe("createCursorAgent", () => {
  test("returns an AgentFn", () => {
    const agent = createCursorAgent({
      workdir: "/tmp",
      model: null,
      timeout: null,
    });
    expect(typeof agent).toBe("function");
  });

  test("throws on invalid config at construction", () => {
    expect(() =>
      createCursorAgent({
        workdir: "",
        model: null,
        timeout: null,
      }),
    ).toThrow();
  });
});
