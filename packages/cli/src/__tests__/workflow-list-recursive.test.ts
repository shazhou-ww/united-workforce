import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, WorkflowPayload } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { cmdThreadStart } from "../commands/thread.js";
import { cmdWorkflowList } from "../commands/workflow.js";
import type { UwfStore } from "../store.js";
import { createUwfStore, discoverProjectWorkflows } from "../store.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_HOME = casDir;
  return createUwfStore(storageRoot);
}

function makeMinimalPayload(name: string, description: string): WorkflowPayload {
  return {
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

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "uwf-wf-list-recursive-"));
  storageRoot = join(tmpDir, "storage");
  projectRoot = join(tmpDir, "project");
  await mkdir(storageRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── discoverProjectWorkflows — parent traversal ───────────────────────────────

describe("discoverProjectWorkflows — parent traversal", () => {
  test("B1: finds workflows in cwd's .workflow/", async () => {
    const wfDir = join(projectRoot, ".workflow");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const entries = await discoverProjectWorkflows(projectRoot);

    expect(entries.map((e) => e.name)).toContain("solve-issue");
  });

  test("B2: finds workflows in ancestor's .workflow/ when called from subdirectory", async () => {
    const wfDir = join(projectRoot, ".workflow");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const subdir = join(projectRoot, "packages", "cli", "src");
    await mkdir(subdir, { recursive: true });

    const entries = await discoverProjectWorkflows(subdir);

    expect(entries.map((e) => e.name)).toContain("solve-issue");
  });

  test("B3: returns [] when no .workflow/ exists in any ancestor", async () => {
    // Use a deep path under tmpDir that has no .workflow/ on the way up.
    // (Traversal will stop at filesystem root and find nothing.)
    const deepPath = join(tmpDir, "isolated", "no", "workflow", "here");
    await mkdir(deepPath, { recursive: true });

    const entries = await discoverProjectWorkflows(deepPath);

    expect(entries).toEqual([]);
  });

  test("B4: .workflow/ entries win over .workflows/ within the same directory", async () => {
    const wfDir = join(projectRoot, ".workflow");
    const legacyDir = join(projectRoot, ".workflows");
    await mkdir(wfDir, { recursive: true });
    await mkdir(legacyDir, { recursive: true });

    await writeFile(
      join(wfDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "new"),
    );
    await writeFile(
      join(legacyDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "legacy"),
    );

    const entries = await discoverProjectWorkflows(projectRoot);

    const match = entries.find((e) => e.name === "solve-issue");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(wfDir, "solve-issue.yaml"));
  });

  test("B5: nearest .workflow/ wins over ancestor's .workflow/", async () => {
    const ancestorWf = join(projectRoot, ".workflow");
    await mkdir(ancestorWf, { recursive: true });
    await writeFile(join(ancestorWf, "foo.yaml"), await createWorkflowYaml("foo", "ancestor"));

    const nearDir = join(projectRoot, "pkg");
    const nearWf = join(nearDir, ".workflow");
    await mkdir(nearWf, { recursive: true });
    await writeFile(join(nearWf, "foo.yaml"), await createWorkflowYaml("foo", "near"));

    const entries = await discoverProjectWorkflows(nearDir);

    const match = entries.find((e) => e.name === "foo");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(nearWf, "foo.yaml"));
    // Should not include duplicates from ancestor
    expect(entries.filter((e) => e.name === "foo")).toHaveLength(1);
  });

  test("B6: returns all entries from the nearest .workflow/ when called from a deep subdir", async () => {
    const wfDir = join(projectRoot, ".workflow");
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));
    await writeFile(join(wfDir, "review-code.yaml"), await createWorkflowYaml("review-code"));

    const deep = join(projectRoot, "a", "b", "c", "d");
    await mkdir(deep, { recursive: true });

    const entries = await discoverProjectWorkflows(deep);

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["review-code", "solve-issue"]);
  });

  test("B7: discovers folder-based layout (name/index.yaml) via parent traversal", async () => {
    const folderDir = join(projectRoot, ".workflow", "solve-issue");
    await mkdir(folderDir, { recursive: true });
    await writeFile(join(folderDir, "index.yaml"), await createWorkflowYaml("solve-issue"));

    const subdir = join(projectRoot, "deep", "sub");
    await mkdir(subdir, { recursive: true });

    const entries = await discoverProjectWorkflows(subdir);

    const match = entries.find((e) => e.name === "solve-issue");
    expect(match).toBeDefined();
    expect(match?.filePath).toBe(join(folderDir, "index.yaml"));
  });
});

// ── cmdWorkflowList — parent traversal ───────────────────────────────────────

describe("cmdWorkflowList — parent traversal", () => {
  test("B9: lists local workflows discovered from a subdirectory", async () => {
    await makeUwfStore(storageRoot);
    const wfDir = join(projectRoot, ".workflow");
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
    const wfDir = join(projectRoot, ".workflow");
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
