import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  cmdSkillActor,
  cmdSkillAdapter,
  cmdSkillArchitecture,
  cmdSkillAuthor,
  cmdSkillCli,
  cmdSkillDeveloper,
  cmdSkillList,
  cmdSkillModerator,
  cmdSkillUser,
  cmdSkillYaml,
} from "../commands/skill.js";

describe("skill commands", () => {
  test("skill list returns all skill names", () => {
    const result = cmdSkillList();
    expect(result).toBeInstanceOf(Array);
    expect(result).toContain("cli");
    expect(result).toContain("architecture");
    expect(result).toContain("yaml");
    expect(result).toContain("moderator");
    expect(result).toContain("actor");
    expect(result).toContain("user");
    expect(result).toContain("author");
    expect(result).toContain("developer");
    expect(result).toContain("adapter");
    for (const name of result) {
      expect(name).toMatch(/^\S+$/);
    }
  });

  test("skill architecture returns non-empty markdown string", () => {
    const result = cmdSkillArchitecture();
    expect(typeof result).toBe("string");
    expect(result).toContain("CAS");
    expect(result).toContain("Thread");
    expect(result).toContain("Workflow");
    expect(result).toContain("Step");
    expect(result.length).toBeGreaterThan(200);
  });

  test("skill yaml returns non-empty markdown string", () => {
    const result = cmdSkillYaml();
    expect(typeof result).toBe("string");
    expect(result).toContain("roles");
    expect(result).toContain("graph");
    expect(result).toContain("frontmatter");
    expect(result.length).toBeGreaterThan(200);
  });

  test("skill moderator returns non-empty markdown string", () => {
    const result = cmdSkillModerator();
    expect(typeof result).toBe("string");
    expect(result).toContain("routing");
    expect(result).toContain("status");
    expect(result.length).toBeGreaterThan(200);
    // Check for edge or graph
    expect(result).toMatch(/edge|graph/i);
  });

  test("skill cli returns CLI reference markdown", () => {
    const result = cmdSkillCli();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
  });

  test("skill actor returns non-empty markdown string", () => {
    const result = cmdSkillActor();
    expect(typeof result).toBe("string");
    expect(result).toContain("frontmatter");
    expect(result).toContain("CAS");
    expect(result).toContain("status");
    expect(result.length).toBeGreaterThan(200);
  });

  test("skill user returns non-empty markdown string", () => {
    const result = cmdSkillUser();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
    expect(result).toContain("thread");
    expect(result).toContain("workflow");
    expect(result).toContain("Quick Start");
    expect(result.length).toBeGreaterThan(500);
  });

  test("skill author returns non-empty markdown string", () => {
    const result = cmdSkillAuthor();
    expect(typeof result).toBe("string");
    expect(result).toContain("frontmatter");
    expect(result).toContain("graph");
    expect(result).toContain("$START");
    expect(result).toContain("$END");
    expect(result).toContain("$status");
    expect(result.length).toBeGreaterThan(500);
  });

  test("skill developer returns non-empty markdown string", () => {
    const result = cmdSkillDeveloper();
    expect(typeof result).toBe("string");
    expect(result).toContain("Monorepo");
    expect(result).toContain("CAS");
    expect(result).toContain("Biome");
    expect(result.length).toBeGreaterThan(500);
  });

  test("skill adapter returns non-empty markdown string", () => {
    const result = cmdSkillAdapter();
    expect(typeof result).toBe("string");
    expect(result).toContain("createAgent");
    expect(result).toContain("AgentContext");
    expect(result).toContain("frontmatter");
    expect(result.length).toBeGreaterThan(500);
  });

  test("skill help subcommand is suppressed", () => {
    const output = execFileSync("bun", ["src/cli.ts", "skill", "--help"], {
      cwd: join(__dirname, "..", ".."),
      encoding: "utf-8",
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
    });
    expect(output).not.toMatch(/help\s+\[command\]/i);
    expect(output).toContain("cli");
    expect(output).toContain("architecture");
    expect(output).toContain("yaml");
    expect(output).toContain("moderator");
    expect(output).toContain("actor");
    expect(output).toContain("user");
    expect(output).toContain("author");
    expect(output).toContain("developer");
    expect(output).toContain("adapter");
    expect(output).toContain("list");
  });
});
