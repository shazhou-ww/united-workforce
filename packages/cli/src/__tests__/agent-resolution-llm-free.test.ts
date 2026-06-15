import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkflowConfig } from "@united-workforce/util-agent";
import { afterEach, describe, expect, test } from "vitest";

describe("agent resolution works without LLM fields in config.yaml (issue #143)", () => {
  let tempDir: string;
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test("loadWorkflowConfig succeeds on a minimal engine-only config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "uwf-engine-cfg-"));
    writeFileSync(
      join(tempDir, "config.yaml"),
      "agents:\n  hermes: { host: 'http://127.0.0.1:7900', gateway: hermes }\ndefaultAgent: hermes\n",
      "utf8",
    );
    const cfg = await loadWorkflowConfig(tempDir);
    expect(cfg.defaultAgent).toBe("hermes");
    expect(cfg.agents.hermes).toBeDefined();
    expect(cfg.agents.hermes.host).toBe("http://127.0.0.1:7900");
    expect(cfg.agents.hermes.gateway).toBe("hermes");
    expect(cfg.agentOverrides).toBeNull();
  });

  test("loadWorkflowConfig ignores legacy provider/model fields", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "uwf-engine-cfg-"));
    writeFileSync(
      join(tempDir, "config.yaml"),
      "providers:\n  openai: { baseUrl: x, apiKey: y }\nmodels:\n  default: { provider: openai, name: gpt-4o }\ndefaultModel: default\nagents:\n  hermes: { host: 'http://127.0.0.1:7900', gateway: hermes }\ndefaultAgent: hermes\n",
      "utf8",
    );
    const cfg = (await loadWorkflowConfig(tempDir)) as Record<string, unknown>;
    expect(cfg.defaultAgent).toBe("hermes");
    expect(cfg.providers).toBeUndefined();
    expect(cfg.models).toBeUndefined();
    expect(cfg.defaultModel).toBeUndefined();
  });

  test("loadWorkflowConfig rejects legacy {command, args} agent shape", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "uwf-engine-cfg-"));
    writeFileSync(
      join(tempDir, "config.yaml"),
      "agents:\n  hermes: { command: uwf-hermes, args: [] }\ndefaultAgent: hermes\n",
      "utf8",
    );
    await expect(loadWorkflowConfig(tempDir)).rejects.toThrow(/legacy \{command, args\} fields/);
  });
});
