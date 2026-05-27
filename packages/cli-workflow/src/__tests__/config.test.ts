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
    apiKey: sk-test-dashscope-key
  openai:
    baseUrl: https://api.openai.com/v1
    apiKey: sk-test-openai-key
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
      test("deep clones and masks all apiKey values in providers", () => {
        const config = {
          providers: {
            dashscope: {
              baseUrl: "https://example.com",
              apiKey: "sk-test-key-12345",
            },
            openai: {
              baseUrl: "https://api.openai.com",
              apiKey: "sk-another-secret",
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
              apiKey: "***MASKED***",
            },
            openai: {
              baseUrl: "https://api.openai.com",
              apiKey: "***MASKED***",
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

      test("does not mask non-provider apiKey fields", () => {
        const config = {
          apiKey: "root-level-key",
          providers: {
            dashscope: { apiKey: "sk-secret" },
          },
          models: {
            default: { provider: "dashscope" },
          },
        };
        const masked = maskApiKeys(config);
        // Root-level apiKey should NOT be masked
        expect(masked.apiKey).toBe("root-level-key");
        // Provider apiKey SHOULD be masked
        const providers = masked.providers as Record<string, Record<string, unknown>>;
        expect(providers.dashscope.apiKey).toBe("***MASKED***");
      });

      test("handles empty provider object", () => {
        const config = {
          providers: { dashscope: {} },
        };
        const masked = maskApiKeys(config);
        expect(masked).toEqual({ providers: { dashscope: {} } });
      });

      test("handles provider with null apiKey", () => {
        const config = {
          providers: {
            dashscope: { apiKey: null, baseUrl: "https://example.com" },
          },
        };
        const masked = maskApiKeys(config);
        const providers = masked.providers as Record<string, Record<string, unknown>>;
        expect(providers.dashscope.apiKey).toBe("***MASKED***");
        expect(providers.dashscope.baseUrl).toBe("https://example.com");
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

    test("masks all apiKey values in providers section", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        const result = (await cmdConfigList(tempDir)) as Record<string, unknown>;
        const providers = result.providers as Record<string, unknown>;
        const dashscope = providers.dashscope as Record<string, unknown>;
        const openai = providers.openai as Record<string, unknown>;
        expect(dashscope.apiKey).toBe("***MASKED***");
        expect(openai.apiKey).toBe("***MASKED***");
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
          apiKey: "sk-test-dashscope-key",
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

    test("rejects unknown nested key in providers", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(
          cmdConfigSet(tempDir, "providers.myProvider.unknownField", "value"),
        ).rejects.toThrow(/Unknown field.*unknownField.*providers/);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects unknown nested key in models", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "models.default.invalidField", "value")).rejects.toThrow(
          /Unknown field.*invalidField.*models/,
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

    test("rejects nested path on scalar key (defaultModel)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "defaultModel.bar", "value")).rejects.toThrow(
          /defaultModel.*scalar|Cannot set property/i,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects incomplete nested path (providers without field)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "providers.myProvider", "value")).rejects.toThrow(
          /incomplete path|must specify a field/i,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("rejects incomplete nested path (models without field)", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await expect(cmdConfigSet(tempDir, "models.myModel", "value")).rejects.toThrow(
          /incomplete path|must specify a field/i,
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

    test("allows valid nested keys in providers", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "providers.newprovider.baseUrl", "https://example.com");
        await cmdConfigSet(tempDir, "providers.newprovider.apiKey", "sk-test");
        const baseUrl = await cmdConfigGet(tempDir, "providers.newprovider.baseUrl");
        const apiKey = await cmdConfigGet(tempDir, "providers.newprovider.apiKey");
        expect(baseUrl).toBe("https://example.com");
        expect(apiKey).toBe("sk-test");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("allows valid nested keys in models", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "models.gpt4.provider", "openai");
        await cmdConfigSet(tempDir, "models.gpt4.name", "gpt-4o");
        const provider = await cmdConfigGet(tempDir, "models.gpt4.provider");
        const name = await cmdConfigGet(tempDir, "models.gpt4.name");
        expect(provider).toBe("openai");
        expect(name).toBe("gpt-4o");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("allows valid nested keys in agents", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "test-config-"));
      try {
        createTestConfig(tempDir, sampleConfig);
        await cmdConfigSet(tempDir, "agents.hermes.command", "uwf-hermes");
        await cmdConfigSet(tempDir, "agents.hermes.args", '["--flag"]');
        const command = await cmdConfigGet(tempDir, "agents.hermes.command");
        const args = await cmdConfigGet(tempDir, "agents.hermes.args");
        expect(command).toBe("uwf-hermes");
        expect(args).toEqual(["--flag"]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("no legacy apiKeyEnv references", () => {
    test("config.ts has no references to apiKeyEnv", () => {
      const configSource = readFileSync(join(__dirname, "..", "commands", "config.ts"), "utf8");
      expect(configSource).not.toContain("apiKeyEnv");
    });

    test("config.test.ts has no references to apiKeyEnv (except this test)", () => {
      const testSource = readFileSync(__filename, "utf8");
      // Remove this test block's own mentions before checking
      const withoutThisTest = testSource.replace(
        /describe\("no legacy apiKeyEnv references"[\s\S]*$/,
        "",
      );
      expect(withoutThisTest).not.toContain("apiKeyEnv");
    });
  });
});
