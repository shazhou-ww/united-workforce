import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatCliUsage, runCli } from "../src/cli-dispatch.js";
import { cmdInitWorkspace } from "../src/cmd-init.js";
import { pathExists } from "../src/fs-utils.js";

describe("init workspace", () => {
  let parent: string;

  beforeEach(async () => {
    parent = join(tmpdir(), `wf-init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(parent, { recursive: true });
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  test("creates expected files and directories", async () => {
    const created = await cmdInitWorkspace(parent, "my-workflows");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const root = created.value.rootPath;
    expect(await pathExists(join(root, "package.json"))).toBe(true);
    expect(await pathExists(join(root, "biome.json"))).toBe(true);
    expect(await pathExists(join(root, "tsconfig.json"))).toBe(true);
    expect(await pathExists(join(root, "AGENTS.md"))).toBe(true);
    expect(await pathExists(join(root, "README.md"))).toBe(true);
    expect(await pathExists(join(root, "templates"))).toBe(true);
    expect(await pathExists(join(root, "templates", ".gitkeep"))).toBe(true);
    expect(await pathExists(join(root, "workflows", "package.json"))).toBe(true);

    const rootPkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      workspaces: string[];
    };
    expect(rootPkg.workspaces).toEqual(["templates/*", "workflows"]);

    const wfPkg = JSON.parse(await readFile(join(root, "workflows", "package.json"), "utf8")) as {
      type: string;
      dependencies: Record<string, string>;
    };
    expect(wfPkg.type).toBe("module");
    expect(wfPkg.dependencies["@uncaged/workflow"]).toBeDefined();
    expect(wfPkg.dependencies.zod).toBeDefined();

    const tsconfig = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8")) as {
      compilerOptions: { strict: boolean; module: string; target: string };
    };
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.module).toBe("ESNext");
    expect(tsconfig.compilerOptions.target).toBe("ESNext");
  });

  test("AGENTS.md contains coding agent guide sections and terms", async () => {
    const created = await cmdInitWorkspace(parent, "my-workflows");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const agentsPath = join(created.value.rootPath, "AGENTS.md");
    const body = await readFile(agentsPath, "utf8");

    for (const section of [
      "项目结构",
      "核心概念",
      "开发流程",
      "编码规范",
      "Template",
      "Build",
      "常见陷阱",
    ]) {
      expect(body).toContain(section);
    }

    for (const term of [
      "RoleDefinition",
      "WorkflowDefinition",
      "Moderator",
      "AgentFn",
      "ExtractFn",
      "RoleMeta",
    ]) {
      expect(body).toContain(term);
    }

    expect(body).toMatch(/type[\s\S]*interface/i);
    expect(body).toMatch(/function[\s\S]*class/i);
    expect(body).toContain("Crockford Base32");
    expect(body).toMatch(/no[\s\S]*default export/i);
    expect(body).toMatch(/no[\s\S]*console/i);
    expect(body).toMatch(/no[\s\S]*dynamic import/i);

    expect(body).toContain("bun run check");
    expect(body).toContain("bun test");
    expect(body).toContain("uncaged-workflow");
    expect(body).toContain("bun build");
    expect(body).toContain("CLAUDE.md");
    expect(body).toContain("docs/architecture.md");
  });

  test("errors when directory already exists", async () => {
    const first = await cmdInitWorkspace(parent, "dup");
    expect(first.ok).toBe(true);

    const second = await cmdInitWorkspace(parent, "dup");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain("already exists");
    }
  });

  test("errors on invalid workspace name", async () => {
    const slash = await cmdInitWorkspace(parent, "a/b");
    expect(slash.ok).toBe(false);

    const dots = await cmdInitWorkspace(parent, "..");
    expect(dots.ok).toBe(false);

    const empty = await cmdInitWorkspace(parent, "");
    expect(empty.ok).toBe(false);
  });

  test("usage lists init subcommands", () => {
    const u = formatCliUsage();
    expect(u).toContain("uncaged-workflow init workspace <name>");
    expect(u).toContain("uncaged-workflow init template <name>");
  });

  test("runCli rejects unknown init subcommand", async () => {
    const code = await runCli(join(parent, "_storage"), ["init", "bogus", "name"]);
    expect(code).toBe(1);
  });

  test.serial("runCli init workspace uses cwd", async () => {
    const prev = process.cwd();
    try {
      process.chdir(parent);
      const code = await runCli(join(parent, "_storage"), ["init", "workspace", "from-cli"]);
      expect(code).toBe(0);
      expect(await pathExists(join(parent, "from-cli", "workflows", "package.json"))).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });
});
