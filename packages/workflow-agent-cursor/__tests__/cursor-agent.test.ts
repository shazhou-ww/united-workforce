import { describe, expect, test } from "bun:test";
import { createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

describe("validateCursorAgentConfig", () => {
  test("accepts valid config with explicit workspace", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
      workspace: "/tmp/test-project",
      llmProvider: null,
    });
    expect(r.ok).toBe(true);
  });

  test("accepts valid config with null workspace and llmProvider", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
      workspace: null,
      llmProvider: { baseUrl: "http://localhost", apiKey: "test", model: "test" },
    });
    expect(r.ok).toBe(true);
  });

  test("rejects non-absolute command", () => {
    const r = validateCursorAgentConfig({
      command: "cursor-agent",
      model: null,
      timeout: 0,
      workspace: "/tmp/test-project",
      llmProvider: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("absolute path");
    }
  });

  test("rejects empty workspace string", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
      workspace: "",
      llmProvider: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("workspace");
    }
  });

  test("rejects null workspace without llmProvider", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
      workspace: null,
      llmProvider: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("llmProvider");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateCursorAgentConfig({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: -1,
      workspace: "/tmp/test-project",
      llmProvider: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe("createCursorAgent", () => {
  test("returns an AgentFn with explicit workspace", () => {
    const agent = createCursorAgent({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
      workspace: "/tmp/test-project",
      llmProvider: null,
    });
    expect(typeof agent).toBe("function");
  });

  test("returns an AgentFn with null workspace and llmProvider", () => {
    const agent = createCursorAgent({
      command: "/usr/local/bin/cursor-agent",
      model: null,
      timeout: 0,
      workspace: null,
      llmProvider: { baseUrl: "http://localhost", apiKey: "test", model: "test" },
    });
    expect(typeof agent).toBe("function");
  });

  test("throws on invalid config at construction", () => {
    expect(() =>
      createCursorAgent({
        command: "/usr/local/bin/cursor-agent",
        model: null,
        timeout: -1,
        workspace: "/tmp/test-project",
        llmProvider: null,
      }),
    ).toThrow();
  });

  test("throws when null workspace without llmProvider", () => {
    expect(() =>
      createCursorAgent({
        command: "/usr/local/bin/cursor-agent",
        model: null,
        timeout: 0,
        workspace: null,
        llmProvider: null,
      }),
    ).toThrow();
  });
});
