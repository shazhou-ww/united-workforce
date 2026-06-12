import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, WorkflowPayload } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { cmdThreadStart } from "../commands/thread.js";
import { cmdWorkflowList } from "../commands/workflow.js";
import { discoverProjectWorkflows } from "../store.js";
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

// ── fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let storageRoot: string;
let projectRoot: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "uwf-wf-list-recursive-"));
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

// ── discoverProjectWorkflows — parent traversal ───────────────────────────────

describe("discoverProjectWorkflows — parent traversal", () => {
  test("T1: finds workflows in cwd's .workflows/", async () => {
    const wfDir = join(projectRoot, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const entries = await discoverProjectWorkflows(projectRoot);

    expect(entries.map((e) => e.name)).toContain("solve-issue");
  });

  test("T2: finds workflows in ancestor's .workflows/ when called from subdirectory", async () => {
    const wfDir = join(projectRoot, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const subdir = join(projectRoot, "packages", "cli", "src");
    await mkdir(subdir, { recursive: true });

    const entries = await discoverProjectWorkflows(subdir);

    expect(entries.map((e) => e.name)).toContain("solve-issue");
  });

  test("T3: returns [] when no .workflows/ or .workflow/ exists in any ancestor", async () => {
    // Use a deep path under tmpDir that has no .workflows/ or .workflow/ on the way up.
    // (Traversal will stop at filesystem root and find nothing.)
    const deepPath = join(tmpDir, "isolated", "no", "workflow", "here");
    await mkdir(deepPath, { recursive: true });

    const entries = await discoverProjectWorkflows(deepPath);

    expect(entries).toEqual([]);
  });

  test("T4: .workflows/ entries win over .workflow/ within the same directory", async () => {
    const primaryDir = join(projectRoot, ".workflows");
    const legacyDir = join(projectRoot, ".workflow");
    await mkdir(primaryDir, { recursive: true });
    await mkdir(legacyDir, { recursive: true });

    await writeFile(
      join(primaryDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "new"),
    );
    await writeFile(
      join(legacyDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "legacy"),
    );

    const entries = await discoverProjectWorkflows(projectRoot);

    const match = entries.find((e) => e.name === "solve-issue");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(primaryDir, "solve-issue.yaml"));
  });

  test("T5: nearest .workflows/ wins over ancestor's .workflows/", async () => {
    const ancestorWf = join(projectRoot, ".workflows");
    await mkdir(ancestorWf, { recursive: true });
    await writeFile(join(ancestorWf, "foo.yaml"), await createWorkflowYaml("foo", "ancestor"));

    const nearDir = join(projectRoot, "pkg");
    const nearWf = join(nearDir, ".workflows");
    await mkdir(nearWf, { recursive: true });
    await writeFile(join(nearWf, "foo.yaml"), await createWorkflowYaml("foo", "near"));

    const entries = await discoverProjectWorkflows(nearDir);

    const match = entries.find((e) => e.name === "foo");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(nearWf, "foo.yaml"));
    // Should not include duplicates from ancestor
    expect(entries.filter((e) => e.name === "foo")).toHaveLength(1);
  });

  test("T6: returns all entries from the nearest .workflows/ when called from a deep subdir", async () => {
    const wfDir = join(projectRoot, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));
    await writeFile(join(wfDir, "review-code.yaml"), await createWorkflowYaml("review-code"));

    const deep = join(projectRoot, "a", "b", "c", "d");
    await mkdir(deep, { recursive: true });

    const entries = await discoverProjectWorkflows(deep);

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["review-code", "solve-issue"]);
  });

  test("T7: discovers folder-based layout (name/index.yaml) via parent traversal under .workflows/", async () => {
    const folderDir = join(projectRoot, ".workflows", "solve-issue");
    await mkdir(folderDir, { recursive: true });
    await writeFile(join(folderDir, "index.yaml"), await createWorkflowYaml("solve-issue"));

    const subdir = join(projectRoot, "deep", "sub");
    await mkdir(subdir, { recursive: true });

    const entries = await discoverProjectWorkflows(subdir);

    const match = entries.find((e) => e.name === "solve-issue");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(folderDir, "index.yaml"));
  });

  test("T8: .workflow/ (legacy) is still discovered when .workflows/ does not exist", async () => {
    const legacyDir = join(projectRoot, ".workflow");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const entries = await discoverProjectWorkflows(projectRoot);

    const match = entries.find((e) => e.name === "solve-issue");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(legacyDir, "solve-issue.yaml"));
  });

  test("T9: nearest directory with EITHER variant stops traversal", async () => {
    // Setup: ancestor .workflows/ + near .workflow/ only — near wins, ancestor not merged.
    const ancestorWf = join(tmpDir, ".workflows");
    await mkdir(ancestorWf, { recursive: true });
    await writeFile(join(ancestorWf, "leak.yaml"), await createWorkflowYaml("leak"));

    const nearLegacyDir = join(projectRoot, ".workflow");
    await mkdir(nearLegacyDir, { recursive: true });
    await writeFile(join(nearLegacyDir, "local.yaml"), await createWorkflowYaml("local"));

    const entries = await discoverProjectWorkflows(projectRoot);
    const names = entries.map((e) => e.name);
    expect(names).toContain("local");
    expect(names).not.toContain("leak");
  });
});

// ── discoverProjectWorkflows — .git boundary ─────────────────────────────────

describe("discoverProjectWorkflows — .git boundary", () => {
  test("G1: .git directory stops traversal", async () => {
    // Setup: tmpDir/repo/.git/ (dir), tmpDir/.workflows/leak.yaml, start from tmpDir/repo/sub/deep/
    const repoDir = join(tmpDir, "repo");
    const gitDir = join(repoDir, ".git");
    await mkdir(gitDir, { recursive: true });

    // Workflow above repo root — should NOT be reachable
    const leakDir = join(tmpDir, ".workflows");
    await mkdir(leakDir, { recursive: true });
    await writeFile(join(leakDir, "leak.yaml"), await createWorkflowYaml("leak"));

    const startFrom = join(repoDir, "sub", "deep");
    await mkdir(startFrom, { recursive: true });

    const entries = await discoverProjectWorkflows(startFrom);
    expect(entries).toEqual([]);
  });

  test("G2: .git file (worktree) stops traversal", async () => {
    // Setup: tmpDir/repo/.git as a FILE, tmpDir/.workflows/leak.yaml, start from tmpDir/repo/pkg/
    const repoDir = join(tmpDir, "repo");
    await mkdir(repoDir, { recursive: true });
    await writeFile(join(repoDir, ".git"), "gitdir: /some/other/path/.git/worktrees/repo");

    const leakDir = join(tmpDir, ".workflows");
    await mkdir(leakDir, { recursive: true });
    await writeFile(join(leakDir, "leak.yaml"), await createWorkflowYaml("leak"));

    const startFrom = join(repoDir, "pkg");
    await mkdir(startFrom, { recursive: true });

    const entries = await discoverProjectWorkflows(startFrom);
    expect(entries).toEqual([]);
  });

  test("G3: workflow at .git boundary IS found (primary .workflows/)", async () => {
    // Setup: tmpDir/repo/.git/ (dir), tmpDir/repo/.workflows/local.yaml, start from tmpDir/repo/sub/
    const repoDir = join(tmpDir, "repo");
    const gitDir = join(repoDir, ".git");
    await mkdir(gitDir, { recursive: true });

    const wfDir = join(repoDir, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "local.yaml"), await createWorkflowYaml("local"));

    const startFrom = join(repoDir, "sub");
    await mkdir(startFrom, { recursive: true });

    const entries = await discoverProjectWorkflows(startFrom);
    expect(entries.map((e) => e.name)).toContain("local");
  });

  test("G4: workflow below .git is found, above is not", async () => {
    // Setup: tmpDir/repo/.git/ + tmpDir/repo/.workflows/local.yaml + tmpDir/.workflows/leak.yaml
    const repoDir = join(tmpDir, "repo");
    const gitDir = join(repoDir, ".git");
    await mkdir(gitDir, { recursive: true });

    const localWfDir = join(repoDir, ".workflows");
    await mkdir(localWfDir, { recursive: true });
    await writeFile(join(localWfDir, "local.yaml"), await createWorkflowYaml("local"));

    const leakDir = join(tmpDir, ".workflows");
    await mkdir(leakDir, { recursive: true });
    await writeFile(join(leakDir, "leak.yaml"), await createWorkflowYaml("leak"));

    const startFrom = join(repoDir, "sub");
    await mkdir(startFrom, { recursive: true });

    const entries = await discoverProjectWorkflows(startFrom);
    expect(entries.map((e) => e.name)).toEqual(["local"]);
  });
});

// ── findWorkflowInParents (via cmdThreadStart) — .git boundary ───────────────

describe("findWorkflowInParents via cmdThreadStart — .git boundary", () => {
  test("G5: .git stops traversal — workflow above boundary is not found", async () => {
    await makeUwfStore(storageRoot);
    const repoDir = join(tmpDir, "repo");
    const gitDir = join(repoDir, ".git");
    await mkdir(gitDir, { recursive: true });

    // Workflow above .git boundary
    const leakDir = join(tmpDir, ".workflows");
    await mkdir(leakDir, { recursive: true });
    await writeFile(join(leakDir, "leak.yaml"), await createWorkflowYaml("leak"));

    const startFrom = join(repoDir, "sub");
    await mkdir(startFrom, { recursive: true });

    // cmdThreadStart should fail — "leak" is above the .git boundary
    await expect(cmdThreadStart(storageRoot, "leak", "prompt", startFrom)).rejects.toThrow();
  });

  test("G6: workflow at .git boundary IS found via cmdThreadStart", async () => {
    await makeUwfStore(storageRoot);
    const repoDir = join(tmpDir, "repo");
    const gitDir = join(repoDir, ".git");
    await mkdir(gitDir, { recursive: true });

    const wfDir = join(repoDir, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "local.yaml"), await createWorkflowYaml("local"));

    const startFrom = join(repoDir, "sub");
    await mkdir(startFrom, { recursive: true });

    const result = await cmdThreadStart(storageRoot, "local", "prompt", startFrom);
    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });
});

// ── cmdWorkflowList — parent traversal ───────────────────────────────────────

describe("cmdWorkflowList — parent traversal", () => {
  test("B9: lists local workflows discovered from a subdirectory", async () => {
    await makeUwfStore(storageRoot);
    const wfDir = join(projectRoot, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const subdir = join(projectRoot, "packages", "foo", "src");
    await mkdir(subdir, { recursive: true });

    const result = await cmdWorkflowList(storageRoot, subdir);

    const match = result.find((e) => e.name === "solve-issue");
    expect(match).toBeDefined();
    expect(match?.hash).toBe("(local)");
    expect(match?.origin).toBe("local");
  });

  test("aligns with cmdThreadStart discovery from same subdirectory", async () => {
    await makeUwfStore(storageRoot);
    const wfDir = join(projectRoot, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "foo.yaml"), await createWorkflowYaml("foo"));

    const subdir = join(projectRoot, "packages", "foo", "src");
    await mkdir(subdir, { recursive: true });

    // cmdThreadStart already resolves foo successfully from subdir (existing behavior)
    const startResult = await cmdThreadStart(storageRoot, "foo", "prompt", subdir);
    expect(startResult.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

    // cmdWorkflowList must ALSO include foo (newly aligned behavior)
    const listResult = await cmdWorkflowList(storageRoot, subdir);
    const match = listResult.find((e) => e.name === "foo");
    expect(match).toBeDefined();
    expect(match?.origin).toBe("local");
  });
});
