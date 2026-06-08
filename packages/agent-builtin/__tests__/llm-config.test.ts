import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadBuiltinLlmConfig } from "../src/llm/config.js";

describe("loadBuiltinLlmConfig (issue #143)", () => {
  let storageRoot: string;
  afterEach(() => {
    if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
  });

  test("reads builtin's own config, independent of engine config.yaml", async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "uwf-builtin-"));
    mkdirSync(join(storageRoot, "agents"), { recursive: true });
    writeFileSync(
      join(storageRoot, "agents", "builtin.yaml"),
      "provider:\n  baseUrl: https://api.openai.com/v1\n  apiKey: sk-test\nmodel: gpt-4o-mini\n",
      "utf8",
    );
    const provider = await loadBuiltinLlmConfig(storageRoot);
    expect(provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(provider.apiKey).toBe("sk-test");
    expect(provider.model).toBe("gpt-4o-mini");
  });

  test("throws a clear error if builtin.yaml missing", async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "uwf-builtin-"));
    await expect(loadBuiltinLlmConfig(storageRoot)).rejects.toThrow(/agents\/builtin\.yaml/);
  });

  test("throws if apiKey missing or empty", async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "uwf-builtin-"));
    mkdirSync(join(storageRoot, "agents"), { recursive: true });
    writeFileSync(
      join(storageRoot, "agents", "builtin.yaml"),
      'provider:\n  baseUrl: https://api.openai.com/v1\n  apiKey: ""\nmodel: gpt-4o-mini\n',
      "utf8",
    );
    await expect(loadBuiltinLlmConfig(storageRoot)).rejects.toThrow(/apiKey/);
  });

  test("throws if baseUrl missing", async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "uwf-builtin-"));
    mkdirSync(join(storageRoot, "agents"), { recursive: true });
    writeFileSync(
      join(storageRoot, "agents", "builtin.yaml"),
      "provider:\n  apiKey: sk-test\nmodel: gpt-4o-mini\n",
      "utf8",
    );
    await expect(loadBuiltinLlmConfig(storageRoot)).rejects.toThrow(/baseUrl/);
  });

  test("throws if model missing", async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "uwf-builtin-"));
    mkdirSync(join(storageRoot, "agents"), { recursive: true });
    writeFileSync(
      join(storageRoot, "agents", "builtin.yaml"),
      "provider:\n  baseUrl: https://api.openai.com/v1\n  apiKey: sk-test\n",
      "utf8",
    );
    await expect(loadBuiltinLlmConfig(storageRoot)).rejects.toThrow(/model/);
  });

  test("does NOT read engine config.yaml — even if engine config has providers/models, they are ignored", async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "uwf-builtin-"));
    writeFileSync(
      join(storageRoot, "config.yaml"),
      "agents:\n  builtin: { command: uwf-builtin, args: [] }\ndefaultAgent: builtin\nproviders:\n  openai: { baseUrl: x, apiKey: should-not-be-read }\nmodels:\n  default: { provider: openai, name: gpt-4o }\ndefaultModel: default\n",
      "utf8",
    );
    await expect(loadBuiltinLlmConfig(storageRoot)).rejects.toThrow(/agents\/builtin\.yaml/);
  });
});
