import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..", "..");
const bootstrapPath = join(repoRoot, "BOOTSTRAP.md");
const content = readFileSync(bootstrapPath, "utf-8");

describe("BOOTSTRAP.md — no LLM provider/model references", () => {
  test("setup section does NOT reference provider/model flags", () => {
    expect(content).not.toContain("--provider");
    expect(content).not.toContain("--base-url");
    expect(content).not.toContain("--api-key");
    expect(content).not.toContain("--model");
  });

  test("non-interactive example shows only uwf setup --agent", () => {
    expect(content).toContain("uwf setup --agent");
  });

  test("config example shows only agents, defaultAgent, agentOverrides — no providers/models/defaultModel keys", () => {
    expect(content).not.toContain("providers:");
    expect(content).not.toContain("defaultModel:");
    expect(content).not.toMatch(/^models:/m);
    // Must have agent config keys
    expect(content).toContain("agents:");
    expect(content).toContain("defaultAgent:");
  });

  test("description mentions per-adapter LLM config location", () => {
    expect(content).toMatch(/~\/\.uwf\/agents\//);
  });

  test("config check verifies only agents and defaultAgent — no providers or models.default", () => {
    // Extract the Config Check section
    const configCheckStart = content.indexOf("### Config Check");
    expect(configCheckStart).toBeGreaterThan(-1);
    const configCheckSection = content.slice(configCheckStart);
    expect(configCheckSection).not.toContain("providers");
    expect(configCheckSection).not.toContain("models.default");
    expect(configCheckSection).toContain("agents");
    expect(configCheckSection).toContain("defaultAgent");
  });
});
