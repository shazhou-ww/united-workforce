import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getCasDir,
  getConfigPath,
  getDefaultStorageRoot,
  getEnvPath,
  getGlobalCasDir,
  normalizeWorkflowConfig,
  resolveStorageRoot,
} from "../src/storage.js";

const VALID_CONFIG = {
  defaultAgent: "builtin",
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

describe("normalizeWorkflowConfig — engine config (issue #143)", () => {
  it("accepts a minimal engine config (agents + defaultAgent)", () => {
    const cfg = normalizeWorkflowConfig(VALID_CONFIG);
    expect(cfg.defaultAgent).toBe("builtin");
    expect(cfg.agents.builtin.command).toBe("uwf-builtin");
    expect(cfg.agents.builtin.args).toEqual(["--verbose"]);
    expect(cfg.agentOverrides).toBeNull();
  });

  it("does NOT carry providers/models/defaultModel/modelOverrides on result", () => {
    const cfg = normalizeWorkflowConfig(VALID_CONFIG) as Record<string, unknown>;
    expect(cfg.providers).toBeUndefined();
    expect(cfg.models).toBeUndefined();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.modelOverrides).toBeUndefined();
  });

  it("ignores legacy providers/models entries (does not crash, does not surface them)", () => {
    const cfg = normalizeWorkflowConfig({
      providers: { openai: { baseUrl: "x", apiKey: "y" } },
      models: { default: { provider: "openai", name: "gpt-4o" } },
      defaultModel: "default",
      modelOverrides: { extract: "default" },
      ...VALID_CONFIG,
    }) as Record<string, unknown>;
    expect(cfg.providers).toBeUndefined();
    expect(cfg.models).toBeUndefined();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.modelOverrides).toBeUndefined();
  });

  it("throws on non-record root", () => {
    expect(() => normalizeWorkflowConfig("bad")).toThrow("root must be a mapping");
    expect(() => normalizeWorkflowConfig(null)).toThrow("root must be a mapping");
    expect(() => normalizeWorkflowConfig([])).toThrow("root must be a mapping");
  });

  it("throws when defaultAgent missing", () => {
    expect(() => normalizeWorkflowConfig({ agents: {} })).toThrow(/defaultAgent/);
  });

  it("throws on invalid agents entry", () => {
    expect(() => normalizeWorkflowConfig({ ...VALID_CONFIG, agents: "bad" })).toThrow(
      "config.agents must be a mapping",
    );
  });

  it("returns null for undefined agentOverrides", () => {
    const result = normalizeWorkflowConfig(VALID_CONFIG);
    expect(result.agentOverrides).toBeNull();
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
});
