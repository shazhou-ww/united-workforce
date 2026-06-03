import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { _agentNameFromBinary, _printAgentMenu, cmdSetup } from "../commands/setup.js";

// ─── _agentNameFromBinary ────────────────────────────────────────────────────

describe("_agentNameFromBinary", () => {
  test("strips uwf- prefix", () => {
    expect(_agentNameFromBinary("uwf-hermes")).toBe("hermes");
  });

  test("strips uwf- prefix for compound names", () => {
    expect(_agentNameFromBinary("uwf-claude-code")).toBe("claude-code");
  });

  test("returns as-is when no uwf- prefix", () => {
    expect(_agentNameFromBinary("hermes")).toBe("hermes");
  });

  test("handles uwf-builtin", () => {
    expect(_agentNameFromBinary("uwf-builtin")).toBe("builtin");
  });
});

// ─── _printAgentMenu ─────────────────────────────────────────────────────────

describe("_printAgentMenu", () => {
  test("prints known agents with labels", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });

    _printAgentMenu(["uwf-hermes", "uwf-claude-code"]);

    expect(logs.some((l) => l.includes("Hermes"))).toBe(true);
    expect(logs.some((l) => l.includes("Claude Code"))).toBe(true);

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

describe("cmdSetup agent configuration", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "uwf-setup-agent-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const baseArgs = () => ({
    provider: "testprovider",
    baseUrl: "https://api.test.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    storageRoot,
  });

  test("defaults to hermes agent when no agent specified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const result = await cmdSetup(baseArgs());

    expect(result.defaultAgent).toBe("hermes");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents.hermes).toEqual({ command: "uwf-hermes", args: [] });
    expect(config.defaultAgent).toBe("hermes");
  });

  test("writes specified agent as default", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const result = await cmdSetup({ ...baseArgs(), agent: "claude-code" });

    expect(result.defaultAgent).toBe("claude-code");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents["claude-code"]).toEqual({ command: "uwf-claude-code", args: [] });
    expect(config.defaultAgent).toBe("claude-code");
  });

  test("preserves existing agents when adding new one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    // First setup with hermes
    await cmdSetup(baseArgs());
    // Second setup with claude-code
    await cmdSetup({ ...baseArgs(), agent: "claude-code" });

    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents.hermes).toBeDefined();
    expect(config.agents["claude-code"]).toBeDefined();
    expect(config.defaultAgent).toBe("claude-code");
  });

  test("updates defaultAgent on re-run with different agent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await cmdSetup(baseArgs());
    const config1 = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config1.defaultAgent).toBe("hermes");

    await cmdSetup({ ...baseArgs(), agent: "builtin" });
    const config2 = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config2.defaultAgent).toBe("builtin");
  });

  test("normalizes agent name with uwf- prefix to bare name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const result = await cmdSetup({ ...baseArgs(), agent: "uwf-hermes" });

    expect(result.defaultAgent).toBe("hermes");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents.hermes).toEqual({ command: "uwf-hermes", args: [] });
    expect(config.defaultAgent).toBe("hermes");
    // Verify no duplicate uwf- prefix
    expect(config.agents["uwf-hermes"]).toBeUndefined();
  });

  test("normalizes uwf-claude-code to claude-code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const result = await cmdSetup({ ...baseArgs(), agent: "uwf-claude-code" });

    expect(result.defaultAgent).toBe("claude-code");
    const config = parse(readFileSync(join(storageRoot, "config.yaml"), "utf8"));
    expect(config.agents["claude-code"]).toEqual({ command: "uwf-claude-code", args: [] });
    expect(config.defaultAgent).toBe("claude-code");
    // Verify no duplicate uwf- prefix
    expect(config.agents["uwf-claude-code"]).toBeUndefined();
  });
});
