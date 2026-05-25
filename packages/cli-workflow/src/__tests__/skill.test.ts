import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  cmdSkillArchitecture,
  cmdSkillCli,
  cmdSkillList,
  cmdSkillModerator,
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
    for (const name of result) {
      expect(typeof name).toBe("string");
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
    expect(output).toContain("list");
  });
});
