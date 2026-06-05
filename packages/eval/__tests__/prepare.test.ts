import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prepare } from "../src/runner/index.js";

const TASK_YAML = `
name: fix-off-by-one
description: Fix an off-by-one error
workflow: solve-issue
prompt: "Fix the bug"
limits:
  maxSteps: 12
  timeoutMinutes: 20
judges:
  - name: frontmatter-compliance
    weight: 0.5
    builtin: true
  - name: test-pass
    weight: 0.5
    entry: dist/judges/test-pass.js
`;

let taskDir: string;

beforeEach(async () => {
  taskDir = await mkdtemp(join(tmpdir(), "uwf-eval-task-"));
  await writeFile(join(taskDir, "task.yaml"), TASK_YAML, "utf8");
  const fixtureDir = join(taskDir, "fixture");
  await mkdir(join(fixtureDir, "src"), { recursive: true });
  await writeFile(join(fixtureDir, "src", "calc.ts"), "export const add = (a, b) => a + b + 1;\n");
  await writeFile(join(fixtureDir, "package.json"), '{ "name": "fixture" }\n');
});

afterEach(async () => {
  await rm(taskDir, { recursive: true, force: true });
});

describe("prepare", () => {
  test("returns the parsed manifest", async () => {
    const result = await prepare(taskDir);
    expect(result.taskDir).toBe(taskDir);
    expect(result.manifest.name).toBe("fix-off-by-one");
    expect(result.manifest.workflow).toBe("solve-issue");
    expect(result.manifest.limits.maxSteps).toBe(12);
    expect(result.manifest.judges).toHaveLength(2);
  });

  test("copies fixture into a fresh temp work dir", async () => {
    const result = await prepare(taskDir);
    expect(result.workDir).not.toBe(taskDir);
    expect(result.workDir.startsWith(tmpdir())).toBe(true);

    const calc = await readFile(join(result.workDir, "src", "calc.ts"), "utf8");
    expect(calc).toContain("export const add");
    const pkg = await readFile(join(result.workDir, "package.json"), "utf8");
    expect(pkg).toContain("fixture");

    await rm(result.workDir, { recursive: true, force: true });
  });

  test("creates an empty work dir when no fixture/ exists", async () => {
    const noFixtureDir = await mkdtemp(join(tmpdir(), "uwf-eval-nofix-"));
    await writeFile(join(noFixtureDir, "task.yaml"), TASK_YAML, "utf8");

    const result = await prepare(noFixtureDir);
    expect(result.workDir.startsWith(tmpdir())).toBe(true);

    await rm(noFixtureDir, { recursive: true, force: true });
    await rm(result.workDir, { recursive: true, force: true });
  });
});
