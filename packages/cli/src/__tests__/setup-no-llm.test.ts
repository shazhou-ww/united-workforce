import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { cmdSetup } from "../commands/setup.js";

describe("cmdSetup — non-interactive, no LLM args (issue #143)", () => {
  let tempDir: string;
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes config.yaml with only agents + defaultAgent", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "uwf-setup-"));
    await cmdSetup({ agent: "hermes", storageRoot: tempDir });
    const cfg = parse(readFileSync(join(tempDir, "config.yaml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(cfg.defaultAgent).toBe("hermes");
    expect(cfg.agents).toBeDefined();
    expect(cfg.providers).toBeUndefined();
    expect(cfg.models).toBeUndefined();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.modelOverrides).toBeUndefined();
  });

  test("preserves existing agentOverrides on rewrite", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "uwf-setup-"));
    writeFileSync(
      join(tempDir, "config.yaml"),
      "agents:\n  hermes: { host: 'http://127.0.0.1:7900', gateway: hermes }\ndefaultAgent: hermes\nagentOverrides:\n  solve-issue:\n    coder: claude-code\n",
      "utf8",
    );
    await cmdSetup({ agent: "hermes", storageRoot: tempDir });
    const cfg = parse(readFileSync(join(tempDir, "config.yaml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(cfg.agentOverrides).toEqual({ "solve-issue": { coder: "claude-code" } });
  });

  test("creates a default agent entry when missing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "uwf-setup-"));
    await cmdSetup({ agent: "claude-code", storageRoot: tempDir });
    const cfg = parse(readFileSync(join(tempDir, "config.yaml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(cfg.defaultAgent).toBe("claude-code");
    const agents = cfg.agents as Record<string, unknown>;
    expect(agents["claude-code"]).toEqual({
      host: "http://127.0.0.1:7900",
      gateway: "claude-code",
    });
  });
});

describe("cmdSetup public surface — provider/model helpers removed (issue #143)", () => {
  test("module does not export validateModel / provider menus / model menus", async () => {
    const mod = (await import("../commands/setup.js")) as Record<string, unknown>;
    expect(mod.validateModel).toBeUndefined();
    expect(mod.resolvePresetBaseUrl).toBeUndefined();
    expect(mod._printProviderMenu).toBeUndefined();
    expect(mod._resolveProviderChoice).toBeUndefined();
    expect(mod._printModelMenu).toBeUndefined();
    expect(mod._resolveModelChoice).toBeUndefined();
    expect(mod._printValidationResult).toBeUndefined();
  });
});
