import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../src/cli-dispatch.js";
import { cmdInitTemplate } from "../src/commands/init/template.js";
import { cmdInitWorkspace } from "../src/commands/init/workspace.js";
import { pathExists } from "../src/fs-utils.js";

describe("init template", () => {
  let parent: string;

  beforeEach(async () => {
    parent = join(
      tmpdir(),
      `wf-init-template-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(parent, { recursive: true });
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  test("creates templates/<name> with expected files", async () => {
    const ws = await cmdInitWorkspace(parent, "my-workflows");
    expect(ws.ok).toBe(true);
    if (!ws.ok) {
      return;
    }
    const root = ws.value.rootPath;

    const created = await cmdInitTemplate(root, "review-pr");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const tdir = join(root, "templates", "review-pr");
    expect(created.value.templatePath).toBe(tdir);
    expect(await pathExists(join(tdir, "package.json"))).toBe(true);
    expect(await pathExists(join(tdir, "tsconfig.json"))).toBe(true);
    expect(await pathExists(join(tdir, "src", "roles.ts"))).toBe(true);
    expect(await pathExists(join(tdir, "src", "moderator.ts"))).toBe(true);
    expect(await pathExists(join(tdir, "src", "index.ts"))).toBe(true);

    const pkg = JSON.parse(await readFile(join(tdir, "package.json"), "utf8")) as {
      name: string;
      type: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.type).toBe("module");
    expect(pkg.dependencies["@uncaged/workflow"]).toBeDefined();
    expect(pkg.dependencies.zod).toBeDefined();
    expect(pkg.name).toContain("review-pr");

    const idx = await readFile(join(tdir, "src", "index.ts"), "utf8");
    expect(idx).toContain("WorkflowDefinition");

    const roles = await readFile(join(tdir, "src", "roles.ts"), "utf8");
    expect(roles).not.toContain("interface ");
    expect(roles).not.toContain("?:");
    expect(roles).not.toContain("export default");

    const moder = await readFile(join(tdir, "src", "moderator.ts"), "utf8");
    expect(moder).not.toContain("export default");
  });

  test("finds workspace walking up from nested cwd", async () => {
    const ws = await cmdInitWorkspace(parent, "ws");
    expect(ws.ok).toBe(true);
    if (!ws.ok) {
      return;
    }
    const root = ws.value.rootPath;
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });

    const created = await cmdInitTemplate(nested, "nested-tpl");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(await pathExists(join(root, "templates", "nested-tpl", "src", "index.ts"))).toBe(true);
  });

  test("errors when not inside a workflow workspace", async () => {
    const orphan = join(parent, "nowhere");
    await mkdir(orphan, { recursive: true });
    const r = await cmdInitTemplate(orphan, "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("templates/*");
    }
  });

  test("errors when template directory already exists", async () => {
    const ws = await cmdInitWorkspace(parent, "ws");
    expect(ws.ok).toBe(true);
    if (!ws.ok) {
      return;
    }
    const root = ws.value.rootPath;

    const first = await cmdInitTemplate(root, "dup");
    expect(first.ok).toBe(true);

    const second = await cmdInitTemplate(root, "dup");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain("already exists");
    }
  });

  test("errors on invalid template name", async () => {
    const ws = await cmdInitWorkspace(parent, "ws");
    expect(ws.ok).toBe(true);
    if (!ws.ok) {
      return;
    }
    const bad = await cmdInitTemplate(ws.value.rootPath, "a/b");
    expect(bad.ok).toBe(false);
  });

  test.serial("runCli init template uses cwd and succeeds in workspace", async () => {
    const ws = await cmdInitWorkspace(parent, "cli-ws");
    expect(ws.ok).toBe(true);
    if (!ws.ok) {
      return;
    }
    const root = ws.value.rootPath;
    const prev = process.cwd();
    try {
      process.chdir(root);
      const code = await runCli(join(parent, "_storage"), ["init", "template", "from-cli"]);
      expect(code).toBe(0);
      expect(await pathExists(join(root, "templates", "from-cli", "package.json"))).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });
});
