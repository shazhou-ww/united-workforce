import { describe, expect, test } from "bun:test";
import { createHermesAgent, validateHermesAgentConfig } from "../src/index.js";

describe("validateHermesAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateHermesAgentConfig({
      command: "/usr/local/bin/hermes",
      model: null,
      timeout: null,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects non-absolute command", () => {
    const r = validateHermesAgentConfig({
      command: "hermes",
      model: null,
      timeout: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("absolute path");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateHermesAgentConfig({
      command: "/usr/local/bin/hermes",
      model: null,
      timeout: -5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("timeout");
    }
  });
});

describe("createHermesAgent", () => {
  test("returns an AdapterFn even with invalid config (validation deferred to call)", () => {
    const agent = createHermesAgent({
      command: "/usr/local/bin/hermes",
      model: null,
      timeout: -5,
    });
    expect(typeof agent).toBe("function");
  });
});
