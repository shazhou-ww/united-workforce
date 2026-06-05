import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  cmdPromptAdapterDeveloping,
  cmdPromptBootstrap,
  cmdPromptList,
  cmdPromptUsage,
  cmdPromptWorkflowAuthoring,
} from "../commands/prompt.js";

describe("prompt commands", () => {
  test("prompt list returns prompt names (no bootstrap)", () => {
    const result = cmdPromptList();
    expect(result).toBeInstanceOf(Array);
    expect(result).toContain("usage");
    expect(result).toContain("workflow-authoring");
    expect(result).toContain("adapter-developing");
    expect(result).not.toContain("bootstrap");
    for (const name of result) {
      expect(name).toMatch(/^\S+$/);
    }
  });

  test("prompt usage returns only the usage reference with frontmatter", () => {
    const result = cmdPromptUsage();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
    expect(result).toContain("thread");
    expect(result).toContain("workflow");
    expect(result).toContain("Quick Start");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
    // Should NOT contain other references
    expect(result).not.toContain("Workflow Authoring Reference");
    expect(result).not.toContain("Adapter Developing Reference");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt workflow-authoring returns non-empty markdown string with frontmatter", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(typeof result).toBe("string");
    expect(result).toContain("frontmatter");
    expect(result).toContain("graph");
    expect(result).toContain("$START");
    expect(result).toContain("$END");
    expect(result).toContain("$status");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt adapter-developing returns non-empty markdown string with frontmatter", () => {
    const result = cmdPromptAdapterDeveloping();
    expect(typeof result).toBe("string");
    expect(result).toContain("createAgent");
    expect(result).toContain("AgentContext");
    expect(result).toContain("frontmatter");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt bootstrap returns framework-agnostic setup instructions", () => {
    const result = cmdPromptBootstrap();
    expect(typeof result).toBe("string");
    // Skills installation
    expect(result).toContain("uwf prompt usage");
    expect(result).toContain("uwf prompt workflow-authoring");
    expect(result).toContain("uwf prompt adapter-developing");
    expect(result).toContain("uwf-usage");
    expect(result).toContain("uwf-workflow-authoring");
    expect(result).toContain("uwf-adapter-developing");
    // Fresh install scenario
    expect(result).toContain("Fresh Install");
    expect(result).toContain("uwf setup");
    expect(result).toContain("--provider");
    expect(result).toContain("--api-key");
    expect(result).toContain("agent adapter");
    // Upgrade scenario
    expect(result).toContain("Upgrade");
    expect(result).toContain("Migrate");
    // Should NOT contain Hermes-specific paths
    expect(result).not.toContain("~/.hermes/skills/");
    expect(result).not.toContain("> ~/.hermes/");
    expect(result.length).toBeGreaterThan(100);
  });

  test("prompt help subcommand is suppressed", { timeout: 30_000 }, () => {
    const cliPath = join(__dirname, "..", "..", "dist", "cli.js");
    const output = execFileSync("node", [cliPath, "prompt", "--help"], {
      encoding: "utf-8",
      env: { ...process.env },
    });
    expect(output).not.toMatch(/help\s+\[command\]/i);
    expect(output).toContain("usage");
    expect(output).toContain("bootstrap");
    expect(output).toContain("workflow-authoring");
    expect(output).toContain("adapter-developing");
    expect(output).toContain("list");
    // Removed subcommands should not appear as command names
    expect(output).not.toMatch(/^\s+setup\s/m);
    expect(output).not.toContain("usage-reference");
  });
});
