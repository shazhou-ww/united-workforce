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

  // Sample test config
  const sampleConfig = `providers:
  dashscope:
    baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
    apiKeyEnv: DASHSCOPE_API_KEY
  openai:
    baseUrl: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
models:
  default:
    provider: dashscope
    name: qwen-max
  gpt4:
    provider: openai
    name: gpt-4
agents:
  hermes:
    command: uwf-hermes
    args:
      - --provider
      - dashscope
  claude-code:
    command: claude-code
    args:
      - --profile
      - work
defaultAgent: hermes
defaultModel: default
`;

  describe("helper functions", () => {
    describe("parseDotPath", () => {
      test("splits dot notation correctly", () => {
        expect(parseDotPath("a.b.c")).toEqual(["a", "b", "c"]);
        expect(parseDotPath("defaultAgent")).toEqual(["defaultAgent"]);
        expect(parseDotPath("providers.dashscope.baseUrl")).toEqual([
          "providers",
          "dashscope",
          "baseUrl",
        ]);
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
      test("deep clones and masks all apiKeyEnv values in providers", () => {
        const config = {
          providers: {
            dashscope: {
              baseUrl: "https://example.com",
              apiKeyEnv: "DASHSCOPE_API_KEY",
            },
            openai: {
              baseUrl: "https://api.openai.com",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
          models: {
            default: { provider: "dashscope" },
          },
        };
        const masked = maskApiKeys(config);
        expect(masked).toEqual({
          providers: {
            dashscope: {
              baseUrl: "https://example.com",
              apiKeyEnv: "***MASKED***",
            },
            openai: {
              baseUrl: "https://api.openai.com",
              apiKeyEnv: "***MASKED***",
            },
          },
          models: {
            default: { provider: "dashscope" },
          },
        });
        // Ensure it's a deep clone
        expect(masked).not.toBe(config);
      });

      test("handles config without providers", () => {
        const config = { models: { default: { provider: "test" } } };
        const masked = maskApiKeys(config);
        expect(masked).toEqual(config);
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
        expect(result).toHaveProperty("providers");
        expect(result).toHaveProperty("models");
        expect(result).toHaveProperty("agents");
        expect(result).toHaveProperty("defaultAgent");
        expect(result).toHaveProperty("defaultModel");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("masks all apiKeyEnv values in providers section", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = (await cmdConfigList(tempDir)) as Record<string, unknown>;
        const providers = result.providers as Record<string, unknown>;
        const dashscope = providers.dashscope as Record<string, unknown>;
        const openai = providers.openai as Record<string, unknown>;
        expect(dashscope.apiKeyEnv).toBe("***MASKED***");
        expect(openai.apiKeyEnv).toBe("***MASKED***");
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

    test("retrieves top-level string value (defaultModel)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "defaultModel");
        expect(result).toBe("default");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("retrieves nested object (providers.dashscope)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "providers.dashscope");
        expect(result).toEqual({
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKeyEnv: "DASHSCOPE_API_KEY",
        });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("retrieves deeply nested string (providers.dashscope.baseUrl)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "providers.dashscope.baseUrl");
        expect(result).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("retrieves nested string in models (models.default.provider)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "models.default.provider");
        expect(result).toBe("dashscope");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("retrieves array value (agents.hermes.args)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigGet(tempDir, "agents.hermes.args");
        expect(result).toEqual(["--provider", "dashscope"]);
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
        // Verify it was written
        const updated = await cmdConfigGet(tempDir, "defaultAgent");
        expect(updated).toBe("claude-code");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("sets nested string value (providers.dashscope.baseUrl)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const newUrl = "https://new-api.example.com/v1";
        const result = await cmdConfigSet(tempDir, "providers.dashscope.baseUrl", newUrl);
        expect(result).toEqual({
          key: "providers.dashscope.baseUrl",
          value: newUrl,
        });
        // Verify it was written
        const updated = await cmdConfigGet(tempDir, "providers.dashscope.baseUrl");
        expect(updated).toBe(newUrl);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("creates new nested path (providers.newprovider.baseUrl)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const newUrl = "https://new-provider.com/v1";
        const result = await cmdConfigSet(tempDir, "providers.newprovider.baseUrl", newUrl);
        expect(result).toEqual({
          key: "providers.newprovider.baseUrl",
          value: newUrl,
        });
        // Verify it was created
        const updated = await cmdConfigGet(tempDir, "providers.newprovider.baseUrl");
        expect(updated).toBe(newUrl);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("sets array value for args key with valid JSON array", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const newArgs = '["--new", "--flags"]';
        const result = await cmdConfigSet(tempDir, "agents.hermes.args", newArgs);
        expect(result).toEqual({
          key: "agents.hermes.args",
          value: ["--new", "--flags"],
        });
        // Verify it was written
        const updated = await cmdConfigGet(tempDir, "agents.hermes.args");
        expect(updated).toEqual(["--new", "--flags"]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("preserves existing config values when updating one key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "defaultAgent", "claude-code");
        // Verify other values are preserved
        const defaultModel = await cmdConfigGet(tempDir, "defaultModel");
        expect(defaultModel).toBe("default");
        const dashscopeUrl = await cmdConfigGet(tempDir, "providers.dashscope.baseUrl");
        expect(dashscopeUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("creates config file if it doesn't exist", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        const result = await cmdConfigSet(tempDir, "defaultAgent", "hermes");
        expect(result).toEqual({ key: "defaultAgent", value: "hermes" });
        // Verify file was created
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

    test("throws error when array value is invalid JSON for args key", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(
          cmdConfigSet(tempDir, "agents.hermes.args", "[invalid json"),
        ).rejects.toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("sets deeply nested model config (models.gpt4.provider)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigSet(tempDir, "models.gpt4.provider", "new-provider");
        expect(result).toEqual({
          key: "models.gpt4.provider",
          value: "new-provider",
        });
        // Verify it was written
        const updated = await cmdConfigGet(tempDir, "models.gpt4.provider");
        expect(updated).toBe("new-provider");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("sets agent command (agents.claude-code.command)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = await cmdConfigSet(tempDir, "agents.claude-code.command", "new-command");
        expect(result).toEqual({
          key: "agents.claude-code.command",
          value: "new-command",
        });
        // Verify it was written
        const updated = await cmdConfigGet(tempDir, "agents.claude-code.command");
        expect(updated).toBe("new-command");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
