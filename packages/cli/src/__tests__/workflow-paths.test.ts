import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, WorkflowPayload } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { cmdConfigSet, getConfigPath, loadWorkflowPaths } from "../commands/config.js";
import { cmdThreadStart } from "../commands/thread.js";
import { cmdWorkflowList } from "../commands/workflow.js";
import { discoverWorkflowPathsEntries, saveWorkflowRegistry, type UwfStore } from "../store.js";
import { makeUwfStore } from "./thread-test-helpers.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMinimalPayload(name: string, description: string): WorkflowPayload {
  return {
    version: 1,
    name,
    description,
    roles: {
      worker: {
        description: "worker role",
        goal: "do work",
        capabilities: [],
        procedure: "",
        output: "",
        frontmatter: {
          type: "object",
          properties: {
            $status: { const: "done" },
          },
          required: ["$status"],
        } as unknown as CasRef,
      },
    },
    graph: {
      $START: {
        new: { role: "worker", prompt: "start working", location: null },
        resume: { role: "worker", prompt: "resume working", location: null },
      },
      worker: { done: { role: "$END", prompt: "done", location: null } },
    },
  };
}

async function createWorkflowYaml(name: string, version: string | null = null): Promise<string> {
  const payload = makeMinimalPayload(
    name,
    version !== null ? `Test workflow (${version})` : "Test workflow",
  );
  return stringify(payload);
}

async function storeWorkflow(uwf: UwfStore, name: string): Promise<CasRef> {
  const payload = makeMinimalPayload(name, "Test workflow");
  return await uwf.store.cas.put(uwf.schemas.workflow, payload);
}

function writeConfigWithPaths(storageRoot: string, paths: string[]): void {
  const { writeFileSync, mkdirSync, existsSync } = require("node:fs") as typeof import("node:fs");
  const configPath = getConfigPath(storageRoot);
  const dir = join(configPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const { stringify: yamlStringify } = require("yaml") as typeof import("yaml");
  writeFileSync(configPath, yamlStringify({ workflowPaths: paths }), "utf8");
}

// ── fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let storageRoot: string;
let projectRoot: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-wfpaths-test-"));
  storageRoot = join(tmpDir, "storage");
  projectRoot = join(tmpDir, "project");
  await mkdir(storageRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  if (savedOcasHome === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = savedOcasHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ── discoverWorkflowPathsEntries ──────────────────────────────────────────────

describe("discoverWorkflowPathsEntries", () => {
  test("should find workflows in specified directories", async () => {
    const dir1 = join(tmpDir, "workflows1");
    await mkdir(dir1, { recursive: true });
    await writeFile(join(dir1, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));
    await writeFile(join(dir1, "review-pr.yaml"), await createWorkflowYaml("review-pr"));

    const entries = await discoverWorkflowPathsEntries([dir1]);

    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["review-pr", "solve-issue"]);
  });

  test("should handle multiple directories with first dir winning on collision", async () => {
    const dir1 = join(tmpDir, "workflows1");
    const dir2 = join(tmpDir, "workflows2");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });

    await writeFile(join(dir1, "solve-issue.yaml"), await createWorkflowYaml("solve-issue", "v1"));
    await writeFile(join(dir2, "solve-issue.yaml"), await createWorkflowYaml("solve-issue", "v2"));
    await writeFile(join(dir2, "deploy.yaml"), await createWorkflowYaml("deploy"));

    const entries = await discoverWorkflowPathsEntries([dir1, dir2]);

    expect(entries).toHaveLength(2);
    // solve-issue from dir1 wins
    const solveIssue = entries.find((e) => e.name === "solve-issue");
    expect(solveIssue?.filePath).toContain("workflows1");
    // deploy only in dir2
    expect(entries.find((e) => e.name === "deploy")).toBeDefined();
  });

  test("should gracefully skip non-existent directories", async () => {
    const dir1 = join(tmpDir, "workflows1");
    await mkdir(dir1, { recursive: true });
    await writeFile(join(dir1, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const entries = await discoverWorkflowPathsEntries([
      join(tmpDir, "nonexistent"),
      dir1,
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("solve-issue");
  });

  test("should return empty array for empty dirs list", async () => {
    const entries = await discoverWorkflowPathsEntries([]);
    expect(entries).toHaveLength(0);
  });

  test("should find folder-based workflows", async () => {
    const dir1 = join(tmpDir, "workflows1");
    const folderWf = join(dir1, "solve-issue");
    await mkdir(folderWf, { recursive: true });
    await writeFile(join(folderWf, "index.yaml"), await createWorkflowYaml("solve-issue"));

    const entries = await discoverWorkflowPathsEntries([dir1]);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("solve-issue");
  });
});

// ── loadWorkflowPaths ─────────────────────────────────────────────────────────

describe("loadWorkflowPaths", () => {
  test("should return empty array when config does not exist", () => {
    const paths = loadWorkflowPaths(join(tmpDir, "nonexistent-storage"));
    expect(paths).toEqual([]);
  });

  test("should return empty array when workflowPaths key is missing", () => {
    writeConfigWithPaths(storageRoot, []);
    // Write config without workflowPaths
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(getConfigPath(storageRoot), "defaultAgent: hermes\n", "utf8");
    const paths = loadWorkflowPaths(storageRoot);
    expect(paths).toEqual([]);
  });

  test("should resolve paths from config", () => {
    writeConfigWithPaths(storageRoot, ["/absolute/path", "./relative/path"]);
    const paths = loadWorkflowPaths(storageRoot);
    expect(paths[0]).toBe("/absolute/path");
    // relative gets resolved to absolute
    expect(paths[1]).toMatch(/\/relative\/path$/);
  });
});

// ── Thread start resolution with workflowPaths ────────────────────────────────

describe("Strategy 3.5: workflowPaths Resolution", () => {
  test("should resolve workflow from workflowPaths when not found locally", async () => {
    await makeUwfStore(storageRoot);

    // Create workflow in a workflowPaths dir
    const globalDir = join(tmpDir, "global-workflows");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    // Configure workflowPaths
    writeConfigWithPaths(storageRoot, [globalDir]);

    // No local .workflows/ — should fall through to workflowPaths
    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    const uwf = await makeUwfStore(storageRoot);
    const node = uwf.store.cas.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).name).toBe("solve-issue");
    }
  });

  test("should prefer local .workflows/ over workflowPaths", async () => {
    await makeUwfStore(storageRoot);

    // Create workflow in workflowPaths dir
    const globalDir = join(tmpDir, "global-workflows");
    await mkdir(globalDir, { recursive: true });
    await writeFile(
      join(globalDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "global"),
    );

    // Create workflow in local .workflows/
    const localDir = join(projectRoot, ".workflows");
    await mkdir(localDir, { recursive: true });
    await writeFile(
      join(localDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "local"),
    );

    writeConfigWithPaths(storageRoot, [globalDir]);

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", projectRoot);

    const uwf = await makeUwfStore(storageRoot);
    const node = uwf.store.cas.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      // Should be the local version
      expect((node.payload as WorkflowPayload).description).toBe("Test workflow (local)");
    }
  });

  test("should prefer workflowPaths over global registry", async () => {
    const uwf = await makeUwfStore(storageRoot);

    // Register in global registry
    const globalHash = await storeWorkflow(uwf, "solve-issue");
    saveWorkflowRegistry(uwf.varStore, "solve-issue", globalHash);

    // Create workflow in workflowPaths dir
    const pathsDir = join(tmpDir, "paths-workflows");
    await mkdir(pathsDir, { recursive: true });
    await writeFile(
      join(pathsDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "from-paths"),
    );

    writeConfigWithPaths(storageRoot, [pathsDir]);

    const isolatedRoot = join(tmpDir, "isolated");
    await mkdir(isolatedRoot, { recursive: true });

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", isolatedRoot);

    const uwf2 = await makeUwfStore(storageRoot);
    const node = uwf2.store.cas.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).description).toBe("Test workflow (from-paths)");
    }
  });
});

// ── cmdWorkflowList with workflowPaths ────────────────────────────────────────

describe("cmdWorkflowList with workflowPaths", () => {
  test("should include workflowPaths entries with correct origin", async () => {
    await makeUwfStore(storageRoot);

    // Create workflow in workflowPaths dir
    const globalDir = join(tmpDir, "global-workflows");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "deploy.yaml"), await createWorkflowYaml("deploy"));

    writeConfigWithPaths(storageRoot, [globalDir]);

    const result = await cmdWorkflowList(storageRoot, projectRoot);

    const deploy = result.find((e) => e.name === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy?.origin).toBe("paths");
    expect(deploy?.hash).toBe("(paths)");
  });

  test("should show local over paths when names collide", async () => {
    await makeUwfStore(storageRoot);

    // Create in both local and paths
    const globalDir = join(tmpDir, "global-workflows");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const localDir = join(projectRoot, ".workflows");
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    writeConfigWithPaths(storageRoot, [globalDir]);

    const result = await cmdWorkflowList(storageRoot, projectRoot);

    const solveIssue = result.filter((e) => e.name === "solve-issue");
    expect(solveIssue).toHaveLength(1);
    expect(solveIssue[0].origin).toBe("local");
  });

  test("should show paths over registry when names collide", async () => {
    const uwf = await makeUwfStore(storageRoot);

    // Register globally
    const hash = await storeWorkflow(uwf, "deploy");
    saveWorkflowRegistry(uwf.varStore, "deploy", hash);

    // Also in paths
    const pathsDir = join(tmpDir, "paths-workflows");
    await mkdir(pathsDir, { recursive: true });
    await writeFile(join(pathsDir, "deploy.yaml"), await createWorkflowYaml("deploy"));

    writeConfigWithPaths(storageRoot, [pathsDir]);

    const result = await cmdWorkflowList(storageRoot, projectRoot);

    const deploy = result.filter((e) => e.name === "deploy");
    expect(deploy).toHaveLength(1);
    expect(deploy[0].origin).toBe("paths");
  });
});
