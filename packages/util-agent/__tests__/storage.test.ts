import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  resolveStorageRoot,
  getDefaultStorageRoot,
  getCasDir,
  getConfigPath,
  getEnvPath,
  getGlobalCasDir,
  normalizeWorkflowConfig,
} from "../src/storage.js";

const VALID_CONFIG = {
  defaultAgent: "builtin",
  defaultModel: "main",
  providers: { openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-xxx" } },
  models: { main: { provider: "openai", name: "gpt-4" } },
  agents: { builtin: { command: "uwf-builtin", args: ["--verbose"] } },
};

describe("getDefaultStorageRoot", () => {
  it("returns homedir/.uwf", () => {
    expect(getDefaultStorageRoot()).toBe(join(homedir(), ".uwf"));
  });
});

describe("resolveStorageRoot", () => {
  it("uses the override when provided", () => {
    expect(resolveStorageRoot("/tmp/uwf1")).toBe("/tmp/uwf1");
  });

  it("falls back to default when override is null", () => {
    expect(resolveStorageRoot(null)).toBe(getDefaultStorageRoot());
  });

  it("ignores empty override", () => {
    expect(resolveStorageRoot("")).toBe(getDefaultStorageRoot());
  });
});

describe("path helpers", () => {
  it("getCasDir", () => expect(getCasDir("/root")).toBe("/root/cas"));
  it("getConfigPath", () => expect(getConfigPath("/root")).toBe("/root/config.yaml"));
  it("getEnvPath", () => expect(getEnvPath("/root")).toBe("/root/.env"));
});

describe("getGlobalCasDir", () => {
  it("uses the override when provided", () => {
    expect(getGlobalCasDir("/tmp/ocas")).toBe("/tmp/ocas");
  });

  it("defaults to ~/.ocas when override is null", () => {
    expect(getGlobalCasDir(null)).toBe(join(homedir(), ".ocas"));
  });

  it("ignores empty override", () => {
    expect(getGlobalCasDir("")).toBe(join(homedir(), ".ocas"));
  });
});

describe("normalizeWorkflowConfig", () => {
  it("normalizes a valid config", () => {
    const result = normalizeWorkflowConfig(VALID_CONFIG);
    expect(result.defaultAgent).toBe("builtin");
    expect(result.defaultModel).toBe("main");
    expect(result.providers.openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(result.models.main.name).toBe("gpt-4");
    expect(result.agents.builtin.command).toBe("uwf-builtin");
    expect(result.agents.builtin.args).toEqual(["--verbose"]);
    expect(result.modelOverrides).toBeNull();
    expect(result.agentOverrides).toBeNull();
  });

  it("throws on non-record root", () => {
    expect(() => normalizeWorkflowConfig("bad")).toThrow("root must be a mapping");
    expect(() => normalizeWorkflowConfig(null)).toThrow("root must be a mapping");
    expect(() => normalizeWorkflowConfig([])).toThrow("root must be a mapping");
  });

  it("throws when defaultAgent missing", () => {
    expect(() => normalizeWorkflowConfig({ ...VALID_CONFIG, defaultAgent: undefined }))
      .toThrow("defaultAgent and defaultModel");
  });

  it("throws when defaultModel missing", () => {
    expect(() => normalizeWorkflowConfig({ ...VALID_CONFIG, defaultModel: 42 }))
      .toThrow("defaultAgent and defaultModel");
  });

  it("throws on invalid providers entry", () => {
    expect(() => normalizeWorkflowConfig({ ...VALID_CONFIG, providers: { bad: "string" } }))
      .toThrow("config.providers.bad must be a mapping");
  });

  it("throws on invalid models entry", () => {
    expect(() => normalizeWorkflowConfig({ ...VALID_CONFIG, models: { m: { provider: 123, name: "x" } } }))
      .toThrow("config.models.m requires provider and name");
  });

  it("throws on invalid agents entry", () => {
    expect(() => normalizeWorkflowConfig({ ...VALID_CONFIG, agents: "bad" }))
      .toThrow("config.agents must be a mapping");
  });

  it("returns null for undefined modelOverrides", () => {
    const result = normalizeWorkflowConfig(VALID_CONFIG);
    expect(result.modelOverrides).toBeNull();
  });

  it("returns null for null agentOverrides", () => {
    const result = normalizeWorkflowConfig({ ...VALID_CONFIG, agentOverrides: null });
    expect(result.agentOverrides).toBeNull();
  });

  it("normalizes agentOverrides with nested roles", () => {
    const config = {
      ...VALID_CONFIG,
      agentOverrides: {
        "solve-issue": { coder: "hermes", reviewer: "claude" },
      },
    };
    const result = normalizeWorkflowConfig(config);
    expect(result.agentOverrides).toEqual({
      "solve-issue": { coder: "hermes", reviewer: "claude" },
    });
  });

  it("normalizes modelOverrides", () => {
    const config = { ...VALID_CONFIG, modelOverrides: { coding: "fast" } };
    const result = normalizeWorkflowConfig(config);
    expect(result.modelOverrides).toEqual({ coding: "fast" });
  });
});
