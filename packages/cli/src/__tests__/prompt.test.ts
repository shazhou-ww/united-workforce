import { describe, expect, test } from 'vitest';
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  cmdPromptAdapter,
  cmdPromptAuthor,
  cmdPromptDeveloper,
  cmdPromptList,
  cmdPromptSetup,
  cmdPromptUsage,
  cmdPromptUser,
} from "../commands/prompt.js";

describe("prompt commands", () => {
  test("prompt list returns all prompt names", () => {
    const result = cmdPromptList();
    expect(result).toBeInstanceOf(Array);
    expect(result).toContain("user");
    expect(result).toContain("author");
    expect(result).toContain("developer");
    expect(result).toContain("adapter");
    for (const name of result) {
      expect(name).toMatch(/^\S+$/);
    }
  });

  test("prompt user returns non-empty markdown string", () => {
    const result = cmdPromptUser();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
    expect(result).toContain("thread");
    expect(result).toContain("workflow");
    expect(result).toContain("Quick Start");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt author returns non-empty markdown string", () => {
    const result = cmdPromptAuthor();
    expect(typeof result).toBe("string");
    expect(result).toContain("frontmatter");
    expect(result).toContain("graph");
    expect(result).toContain("$START");
    expect(result).toContain("$END");
    expect(result).toContain("$status");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt developer returns non-empty markdown string", () => {
    const result = cmdPromptDeveloper();
    expect(typeof result).toBe("string");
    expect(result).toContain("Monorepo");
    expect(result).toContain("CAS");
    expect(result).toContain("Biome");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt adapter returns non-empty markdown string", () => {
    const result = cmdPromptAdapter();
    expect(typeof result).toBe("string");
    expect(result).toContain("createAgent");
    expect(result).toContain("AgentContext");
    expect(result).toContain("frontmatter");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt usage combines all references", () => {
    const result = cmdPromptUsage();
    expect(typeof result).toBe("string");
    expect(result).toContain("User Reference");
    expect(result).toContain("Author Reference");
    expect(result).toContain("Developer Reference");
    expect(result).toContain("Adapter Reference");
    expect(result).toContain("---");
    expect(result.length).toBeGreaterThan(2000);
  });

  test("prompt setup returns setup instructions", () => {
    const result = cmdPromptSetup();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf Skill Setup");
    expect(result).toContain("uwf prompt usage");
    expect(result).toContain("uwf prompt setup");
    expect(result).toContain("SKILL.md");
    expect(result).toContain("version");
  });

  test("prompt help subcommand is suppressed", () => {
    const output = execFileSync("bun", ["src/cli.ts", "prompt", "--help"], {
      cwd: join(__dirname, "..", ".."),
      encoding: "utf-8",
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
    });
    expect(output).not.toMatch(/help\s+\[command\]/i);
    expect(output).toContain("usage");
    expect(output).toContain("setup");
    expect(output).toContain("user");
    expect(output).toContain("author");
    expect(output).toContain("developer");
    expect(output).toContain("adapter");
    expect(output).toContain("list");
  });
});
