import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  cmdPromptAdapterDeveloping,
  cmdPromptBootstrap,
  cmdPromptList,
  cmdPromptSetup,
  cmdPromptUsage,
  cmdPromptUsageReference,
  cmdPromptWorkflowAuthoring,
} from "../commands/prompt.js";

describe("prompt commands", () => {
  test("prompt list returns new prompt names", () => {
    const result = cmdPromptList();
    expect(result).toBeInstanceOf(Array);
    expect(result).toContain("usage");
    expect(result).toContain("workflow-authoring");
    expect(result).toContain("adapter-developing");
    expect(result).toContain("bootstrap");
    expect(result).not.toContain("user");
    expect(result).not.toContain("author");
    expect(result).not.toContain("developer");
    expect(result).not.toContain("adapter");
    for (const name of result) {
      expect(name).toMatch(/^\S+$/);
    }
  });

  test("prompt usage-reference returns non-empty markdown string with frontmatter", () => {
    const result = cmdPromptUsageReference();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
    expect(result).toContain("thread");
    expect(result).toContain("workflow");
    expect(result).toContain("Quick Start");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
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

  test("prompt bootstrap returns non-empty skill with frontmatter", () => {
    const result = cmdPromptBootstrap();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
    expect(result).toContain("---");
    expect(result.length).toBeGreaterThan(100);
  });

  test("prompt usage combines remaining references (no developer)", () => {
    const result = cmdPromptUsage();
    expect(typeof result).toBe("string");
    expect(result).toContain("Usage Reference");
    expect(result).toContain("Workflow Authoring Reference");
    expect(result).toContain("Adapter Developing Reference");
    expect(result).not.toContain("Developer Reference");
    expect(result).toContain("---");
    expect(result.length).toBeGreaterThan(2000);
  });

  test("prompt setup returns simplified setup instructions", () => {
    const result = cmdPromptSetup();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf Skill Setup");
    expect(result).toContain("uwf prompt bootstrap");
    expect(result).toContain("SKILL.md");
    expect(result).toContain("version");
    expect(result).not.toMatch(/\bbun (install|run|test|changeset|version|release)\b/);
  });

  test("prompt setup references new subcommand names", () => {
    const result = cmdPromptSetup();
    expect(result).toContain("uwf prompt usage");
    expect(result).toContain("uwf prompt workflow-authoring");
    expect(result).toContain("uwf prompt adapter-developing");
    expect(result).not.toContain("uwf prompt user");
    expect(result).not.toContain("uwf prompt author");
    expect(result).not.toContain("uwf prompt developer");
    expect(result).not.toMatch(/uwf prompt adapter\b(?!-developing)/);
  });

  test("prompt help subcommand is suppressed", { timeout: 30_000 }, () => {
    const cliPath = join(__dirname, "..", "..", "dist", "cli.js");
    const output = execFileSync("node", [cliPath, "prompt", "--help"], {
      encoding: "utf-8",
      env: { ...process.env },
    });
    expect(output).not.toMatch(/help\s+\[command\]/i);
    expect(output).toContain("usage");
    expect(output).toContain("setup");
    expect(output).toContain("workflow-authoring");
    expect(output).toContain("adapter-developing");
    expect(output).toContain("bootstrap");
    expect(output).toContain("list");
    expect(output).not.toContain("developer");
  });
});
