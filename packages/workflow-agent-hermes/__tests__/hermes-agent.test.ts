import { describe, expect, test } from "bun:test";
import { createHermesAgent, validateHermesAgentConfig } from "../src/index.js";

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

describe("createHermesAgent", () => {
  test("returns an AgentFn", () => {
    const agent = createHermesAgent({
      model: null,
      timeout: null,
    });
    expect(typeof agent).toBe("function");
  });
});
