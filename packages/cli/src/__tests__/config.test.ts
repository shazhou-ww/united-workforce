import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  cmdConfigGet,
  cmdConfigList,
  cmdConfigSet,
  getConfigPath,
  getNestedValue,
  maskApiKeys,
  parseDotPath,
  setNestedValue,
} from "../commands/config.js";

describe("config command", () => {
  // Helper function to create a test config
  function createTestConfig(tempDir: string, content: string): string {
    const configPath = getConfigPath(tempDir);
    writeFileSync(configPath, content, "utf8");
    return configPath;
  }

  // Sample test config — engine-only (no providers/models/defaultModel/modelOverrides).
  // Phase 3 (#380) replaced the legacy {command, args} agent shape with {host, gateway}.
  const sampleConfig = `agents:
  hermes:
    host: http://127.0.0.1:7900
    gateway: hermes
  claude-code:
    host: http://127.0.0.1:7901
    gateway: claude-code
defaultAgent: hermes
`;

  describe("helper functions", () => {
    describe("parseDotPath", () => {
      test("splits dot notation correctly", () => {
        expect(parseDotPath("a.b.c")).toEqual(["a", "b", "c"]);
        expect(parseDotPath("defaultAgent")).toEqual(["defaultAgent"]);
        expect(parseDotPath("agents.hermes.host")).toEqual(["agents", "hermes", "host"]);
      });
    });

    describe("getNestedValue", () => {
      test("traverses nested objects", () => {
        const obj = {
          a: { b: { c: "value" } },
          x: "simple",
        };
        expect(getNestedValue(obj, ["a", "b", "c"])).toBe("value");
        expect(getNestedValue(obj, ["x"])).toBe("simple");
      });

      test("returns undefined for non-existent paths", () => {
        const obj = { a: { b: "value" } };
        expect(getNestedValue(obj, ["a", "c"])).toBeUndefined();
        expect(getNestedValue(obj, ["x", "y"])).toBeUndefined();
      });
    });

    describe("setNestedValue", () => {
      test("creates intermediate objects and sets value", () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, ["a", "b", "c"], "value");
        expect(obj).toEqual({ a: { b: { c: "value" } } });
      });

      test("preserves existing values", () => {
        const obj: Record<string, unknown> = { a: { x: "keep" } };
        setNestedValue(obj, ["a", "b"], "new");
        expect(obj).toEqual({ a: { x: "keep", b: "new" } });
      });

      test("overwrites existing value at path", () => {
        const obj: Record<string, unknown> = { a: { b: "old" } };
        setNestedValue(obj, ["a", "b"], "new");
        expect(obj).toEqual({ a: { b: "new" } });
      });
    });

    describe("maskApiKeys", () => {
      test("returns deep clone (no mutation) — engine config has no apiKey to mask", () => {
        const config = {
          agents: { hermes: { host: "http://127.0.0.1:7900", gateway: "hermes" } },
          defaultAgent: "hermes",
        };
        const masked = maskApiKeys(config);
        expect(masked).toEqual(config);
        expect(masked).not.toBe(config);
      });
    });
  });

  describe("cmdConfigList", () => {
    test("returns full config when file exists", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigList(tempDir);
        expect(result).toBeDefined();
        expect(typeof result).toBe("object");
        expect(result).toHaveProperty("agents");
        expect(result).toHaveProperty("defaultAgent");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when config file doesn't exist", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        await expect(cmdConfigList(tempDir)).rejects.toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("returns empty object when config file is empty", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, "");
        const result = await cmdConfigList(tempDir);
        expect(result).toEqual({});
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when config file is invalid YAML", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, "invalid: yaml: [broken");
        await expect(cmdConfigList(tempDir)).rejects.toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("cmdConfigGet", () => {
    test("retrieves top-level string value (defaultAgent)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "defaultAgent");
        expect(result).toBe("hermes");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("retrieves nested string value (agents.hermes.host)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "agents.hermes.host");
        expect(result).toBe("http://127.0.0.1:7900");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when key doesn't exist", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigGet(tempDir, "nonexistent.key")).rejects.toThrow(/Key not found/);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when config file doesn't exist", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        await expect(cmdConfigGet(tempDir, "defaultAgent")).rejects.toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when accessing property on non-object", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigGet(tempDir, "defaultAgent.foo")).rejects.toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("cmdConfigSet", () => {
    test("sets top-level string value (defaultAgent)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigSet(tempDir, "defaultAgent", "claude-code");
        expect(result).toEqual({ key: "defaultAgent", value: "claude-code" });
        const updated = await cmdConfigGet(tempDir, "defaultAgent");
        expect(updated).toBe("claude-code");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("sets nested string value (agents.hermes.host)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigSet(tempDir, "agents.hermes.host", "http://10.0.0.1:7900");
        expect(result).toEqual({
          key: "agents.hermes.host",
          value: "http://10.0.0.1:7900",
        });
        const updated = await cmdConfigGet(tempDir, "agents.hermes.host");
        expect(updated).toBe("http://10.0.0.1:7900");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("preserves existing config values when updating one key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "defaultAgent", "claude-code");
        const host = await cmdConfigGet(tempDir, "agents.hermes.host");
        expect(host).toBe("http://127.0.0.1:7900");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("creates config file if it doesn't exist", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        const result = await cmdConfigSet(tempDir, "defaultAgent", "hermes");
        expect(result).toEqual({ key: "defaultAgent", value: "hermes" });
        const configPath = getConfigPath(tempDir);
        const content = readFileSync(configPath, "utf8");
        expect(content).toContain("defaultAgent: hermes");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when setting property on non-object", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "defaultAgent.foo", "bar")).rejects.toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("throws error when value for unknown nested field is invalid", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "agents.hermes.args", "[invalid json")).rejects.toThrow(
          /Unknown field/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("sets agent gateway (agents.claude-code.gateway)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigSet(tempDir, "agents.claude-code.gateway", "new-gateway");
        expect(result).toEqual({
          key: "agents.claude-code.gateway",
          value: "new-gateway",
        });
        const updated = await cmdConfigGet(tempDir, "agents.claude-code.gateway");
        expect(updated).toBe("new-gateway");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("cmdConfigSet — LLM keys removed from engine config (issue #143)", () => {
    test("rejects providers as unknown top-level key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(
          cmdConfigSet(tempDir, "providers.openai.baseUrl", "https://api.openai.com/v1"),
        ).rejects.toThrow(/Unknown config key/);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects models as unknown top-level key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "models.default.provider", "openai")).rejects.toThrow(
          /Unknown config key/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects defaultModel as unknown top-level key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "defaultModel", "default")).rejects.toThrow(
          /Unknown config key/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects modelOverrides as unknown top-level key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "modelOverrides.extract", "fast")).rejects.toThrow(
          /Unknown config key/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("cmdConfigSet validation", () => {
    test("rejects unknown top-level key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "unknownKey", "value")).rejects.toThrow(
          /Unknown config key.*unknownKey/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects unknown nested key in agents", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "agents.hermes.badField", "value")).rejects.toThrow(
          /Unknown field.*badField.*agents/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects nested path on scalar key (defaultAgent)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "defaultAgent.foo", "value")).rejects.toThrow(
          /defaultAgent.*scalar|Cannot set property/i,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects incomplete nested path (agents without field)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "agents.myAgent", "value")).rejects.toThrow(
          /incomplete path|must specify a field/i,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("allows valid nested keys in agents", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "agents.hermes.host", "http://example:7900");
        await cmdConfigSet(tempDir, "agents.hermes.gateway", "hermes-gw");
        const host = await cmdConfigGet(tempDir, "agents.hermes.host");
        const gateway = await cmdConfigGet(tempDir, "agents.hermes.gateway");
        expect(host).toBe("http://example:7900");
        expect(gateway).toBe("hermes-gw");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("agentOverrides — accepts valid 3-segment path", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "agentOverrides.solve-issue.planner", "claude-code");
        const value = await cmdConfigGet(tempDir, "agentOverrides.solve-issue.planner");
        expect(value).toBe("claude-code");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("agentOverrides — rejects incomplete path (2 segments)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "agentOverrides.solve-issue", "hermes")).rejects.toThrow(
          /incomplete path|must specify a field/i,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects unknown top-level key (regression)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "randomKey", "value")).rejects.toThrow(
          /Unknown config key/,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("no legacy apiKeyEnv references", () => {
    test("config.ts has no references to apiKeyEnv", () => {
      const configSource = readFileSync(
        join(__dirname, "..", "..", "src", "commands", "config.ts"),
        "utf8",
      );
      expect(configSource).not.toContain("apiKeyEnv");
    });
  });
});
