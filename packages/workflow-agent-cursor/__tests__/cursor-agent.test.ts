import { describe, expect, test } from "bun:test";
import { createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

describe("validateCursorAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateCursorAgentConfig({
      model: null,
      timeout: 0,
      workspace: "/tmp/test-project",
    });
    expect(r.ok).toBe(true);
  });

  test("rejects non-function extract", () => {
    const r = validateCursorAgentConfig({
      model: null,
      timeout: 0,
      workspace: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("workspace");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateCursorAgentConfig({
      model: null,
      timeout: -1,
      workspace: "/tmp/test-project",
    });
    expect(r.ok).toBe(false);
  });
});

describe("createCursorAgent", () => {
  test("returns an AgentFn", () => {
    const agent = createCursorAgent({
      model: null,
      timeout: 0,
      workspace: "/tmp/test-project",
    });
    expect(typeof agent).toBe("function");
  });

  test("throws on invalid config at construction", () => {
    expect(() =>
      createCursorAgent({
        model: null,
        timeout: -1,
        workspace: "/tmp/test-project",
      }),
    ).toThrow();
  });
});
