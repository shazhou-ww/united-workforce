import { describe, expect, test } from "bun:test";
import { createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

describe("validateCursorAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects non-absolute command", () => {
    const r = validateCursorAgentConfig({
      command: "cursor-agent",
      model: null,
      timeout: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("absolute path");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: -1,
    });
    expect(r.ok).toBe(false);
  });
});

describe("createCursorAgent", () => {
  test("returns an AdapterFn", () => {
    const agent = createCursorAgent({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
    });
    expect(typeof agent).toBe("function");
  });

  test("defers validation to call time (invalid config does not throw at construction)", () => {
    const agent = createCursorAgent({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: -1,
    });
    expect(typeof agent).toBe("function");
  });
});
