import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.UWF_STORAGE_ROOT = process.env.UWF_STORAGE_ROOT;
    saved.WORKFLOW_STORAGE_ROOT = process.env.WORKFLOW_STORAGE_ROOT;
  });

  afterEach(() => {
    for (const k of ["UWF_STORAGE_ROOT", "WORKFLOW_STORAGE_ROOT"] as const) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("uses UWF_STORAGE_ROOT first", () => {
    process.env.UWF_STORAGE_ROOT = "/tmp/uwf1";
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/uwf2";
    expect(resolveStorageRoot()).toBe("/tmp/uwf1");
  });

  it("falls back to WORKFLOW_STORAGE_ROOT", () => {
    delete process.env.UWF_STORAGE_ROOT;
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/uwf2";
    expect(resolveStorageRoot()).toBe("/tmp/uwf2");
  });

  it("falls back to default when both unset", () => {
    delete process.env.UWF_STORAGE_ROOT;
    delete process.env.WORKFLOW_STORAGE_ROOT;
    expect(resolveStorageRoot()).toBe(getDefaultStorageRoot());
  });

  it("ignores empty UWF_STORAGE_ROOT", () => {
    process.env.UWF_STORAGE_ROOT = "";
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/uwf2";
    expect(resolveStorageRoot()).toBe("/tmp/uwf2");
  });
});

describe("path helpers", () => {
  it("getCasDir", () => expect(getCasDir("/root")).toBe("/root/cas"));
  it("getConfigPath", () => expect(getConfigPath("/root")).toBe("/root/config.yaml"));
  it("getEnvPath", () => expect(getEnvPath("/root")).toBe("/root/.env"));
});

describe("getGlobalCasDir", () => {
  const saved = { OCAS_DIR: process.env.OCAS_DIR };

  afterEach(() => {
    if (saved.OCAS_DIR === undefined) delete process.env.OCAS_DIR;
    else process.env.OCAS_DIR = saved.OCAS_DIR;
  });

  it("uses OCAS_DIR when set", () => {
    process.env.OCAS_DIR = "/tmp/ocas";
    expect(getGlobalCasDir()).toBe("/tmp/ocas");
  });

  it("defaults to ~/.ocas", () => {
    delete process.env.OCAS_DIR;
    expect(getGlobalCasDir()).toBe(join(homedir(), ".ocas"));
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
