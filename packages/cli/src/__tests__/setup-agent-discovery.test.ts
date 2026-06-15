import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parse } from "yaml";
import { _agentNameFromBinary, _printAgentMenu, cmdSetup } from "../commands/setup.js";

// ─── _agentNameFromBinary ────────────────────────────────────────────────────

describe("_agentNameFromBinary", () => {
  test("strips uwf- prefix", () => {
    expect(_agentNameFromBinary("uwf-builtin")).toBe("builtin");
  });

  test("strips uwf- prefix for compound names", () => {
    expect(_agentNameFromBinary("uwf-some-gateway")).toBe("some-gateway");
  });

  test("returns as-is when no uwf- prefix", () => {
    expect(_agentNameFromBinary("builtin")).toBe("builtin");
  });

  test("handles uwf-mock", () => {
    expect(_agentNameFromBinary("uwf-mock")).toBe("mock");
  });
});

// ─── _printAgentMenu ─────────────────────────────────────────────────────────

describe("_printAgentMenu", () => {
  test("prints known agents with labels", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });

    _printAgentMenu(["uwf-builtin", "uwf-mock"]);

    expect(logs.some((l) => l.includes("Built-in"))).toBe(true);
    expect(logs.some((l) => l.includes("Mock"))).toBe(true);

    vi.restoreAllMocks();
  });

  test("prints unknown agents with binary name as label", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });

    _printAgentMenu(["uwf-custom-agent"]);

    expect(logs.some((l) => l.includes("uwf-custom-agent"))).toBe(true);

    vi.restoreAllMocks();
  });
});

// ─── cmdSetup agent config ───────────────────────────────────────────────────

describe("cmdSetup agent configuration (engine config is LLM-free, issue #143)", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "uwf-setup-agent-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("writes specified agent as default", async () => {
    const result = await cmdSetup({ agent: "claude-code", storageRoot });

    expect(result.defaultAgent).toBe("claude-code");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents["claude-code"]).toEqual({
      host: "http://127.0.0.1:7900",
      gateway: "claude-code",
    });
    expect(config.defaultAgent).toBe("claude-code");
  });

  test("preserves existing agents when adding new one", async () => {
    await cmdSetup({ agent: "builtin", storageRoot });
    await cmdSetup({ agent: "claude-code", storageRoot });

    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents.builtin).toBeDefined();
    expect(config.agents["claude-code"]).toBeDefined();
    expect(config.defaultAgent).toBe("claude-code");
  });

  test("updates defaultAgent on re-run with different agent", async () => {
    await cmdSetup({ agent: "mock", storageRoot });
    const config1 = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config1.defaultAgent).toBe("mock");

    await cmdSetup({ agent: "builtin", storageRoot });
    const config2 = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config2.defaultAgent).toBe("builtin");
  });

  test("normalizes agent name with uwf- prefix to bare name", async () => {
    const result = await cmdSetup({ agent: "uwf-builtin", storageRoot });

    expect(result.defaultAgent).toBe("builtin");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents.builtin).toEqual({
      host: "http://127.0.0.1:7900",
      gateway: "builtin",
    });
    expect(config.defaultAgent).toBe("builtin");
    // Verify no duplicate uwf- prefix
    expect(config.agents["uwf-builtin"]).toBeUndefined();
  });

  test("normalizes uwf-claude-code to claude-code", async () => {
    const result = await cmdSetup({ agent: "uwf-claude-code", storageRoot });

    expect(result.defaultAgent).toBe("claude-code");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents["claude-code"]).toEqual({
      host: "http://127.0.0.1:7900",
      gateway: "claude-code",
    });
    expect(config.defaultAgent).toBe("claude-code");
    // Verify no duplicate uwf- prefix
    expect(config.agents["uwf-claude-code"]).toBeUndefined();
  });

  test("rewrite drops legacy provider/model fields from existing config", async () => {
    // First create a config that contains legacy LLM fields
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(storageRoot, { recursive: true });
    writeFileSync(
      join(storageRoot, "config.yaml"),
      "providers:\n  openai: { baseUrl: x, apiKey: y }\nmodels:\n  default: { provider: openai, name: gpt-4o }\ndefaultModel: default\nagents:\n  builtin: { host: 'http://127.0.0.1:7900', gateway: builtin }\ndefaultAgent: builtin\n",
      "utf8",
    );
    await cmdSetup({ agent: "builtin", storageRoot });
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.providers).toBeUndefined();
    expect(config.models).toBeUndefined();
    expect(config.defaultModel).toBeUndefined();
    expect(config.agents.builtin).toEqual({
      host: "http://127.0.0.1:7900",
      gateway: "builtin",
    });
    expect(config.defaultAgent).toBe("builtin");
  });
});
