import { describe, expect, test } from "bun:test";
import { createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

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
