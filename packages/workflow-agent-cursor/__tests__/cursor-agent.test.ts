import { describe, expect, test } from "bun:test";
import { createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

const baseConfig = {
  command: "/usr/local/bin/cursor-agent",
  model: null as string | null,
  timeout: 0,
  workspace: null as string | null,
};

describe("validateCursorAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateCursorAgentConfig({
      ...baseConfig,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects non-absolute command", () => {
    const r = validateCursorAgentConfig({
      ...baseConfig,
      command: "cursor-agent",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("absolute path");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateCursorAgentConfig({
      ...baseConfig,
      timeout: -1,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects non-absolute workspace when set", () => {
    const r = validateCursorAgentConfig({
      ...baseConfig,
      workspace: "relative/path",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("workspace");
    }
  });
});

describe("createCursorAgent", () => {
  test("returns an AdapterFn", () => {
    const agent = createCursorAgent({
      ...baseConfig,
    });
    expect(typeof agent).toBe("function");
  });

  test("defers validation to call time (invalid config does not throw at construction)", () => {
    const agent = createCursorAgent({
      ...baseConfig,
      timeout: -1,
    });
    expect(typeof agent).toBe("function");
  });
});
