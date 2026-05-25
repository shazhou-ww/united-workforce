import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore } from "@uncaged/json-cas-fs";
import type { CasRef, WorkflowPayload } from "@uncaged/workflow-protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { cmdThreadStart } from "../commands/thread.js";
import { registerUwfSchemas } from "../schemas.js";
import type { UwfStore } from "../store.js";
import { loadWorkflowRegistry, saveWorkflowRegistry } from "../store.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  const store = createFsStore(casDir);
  const schemas = await registerUwfSchemas(store);
  return { storageRoot, store, schemas };
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
            $status: { type: "string" },
          },
          required: ["$status"],
        } as unknown as CasRef,
      },
    },
    graph: {
      $START: { _: { role: "worker", prompt: "start working" } },
      worker: { _: { role: "$END", prompt: "done" } },
    },
  };
}

async function storeWorkflow(uwf: UwfStore, name: string): Promise<CasRef> {
  const payload = makeMinimalPayload(name, "Test workflow");
  return await uwf.store.put(uwf.schemas.workflow, payload);
}

async function createWorkflowYaml(name: string, version: string | null = null): Promise<string> {
  const payload = makeMinimalPayload(
    name,
    version !== null ? `Test workflow (${version})` : "Test workflow",
  );
  const yaml = stringify(payload);
  return yaml;
}

// ── fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let storageRoot: string;
let projectRoot: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cli-uwf-wf-resolve-test-"));
  storageRoot = join(tmpDir, "storage");
  projectRoot = join(tmpDir, "project");
  await mkdir(storageRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Strategy 1: CAS Hash Resolution ───────────────────────────────────────────

describe("Strategy 1: CAS Hash Resolution", () => {
  test("should resolve valid 13-char Crockford Base32 hash", async () => {
    const uwf = await makeUwfStore(storageRoot);
    const hash = await storeWorkflow(uwf, "test-workflow");

    const result = await cmdThreadStart(storageRoot, hash, "test prompt", projectRoot);

    expect(result.workflow).toBe(hash);
    expect(result.thread).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("should fail on invalid hash format (non-Crockford characters)", async () => {
    await makeUwfStore(storageRoot);

    await expect(
      cmdThreadStart(storageRoot, "123456789ABCD", "prompt", projectRoot),
    ).rejects.toThrow();
  });

  test("should fail on valid-format hash not present in CAS", async () => {
    await makeUwfStore(storageRoot);
    const fakeHash = "0000000000000"; // valid format, doesn't exist

    await expect(cmdThreadStart(storageRoot, fakeHash, "prompt", projectRoot)).rejects.toThrow();
  });

  test("should reject 40-char hex hash (legacy format not supported)", async () => {
    await makeUwfStore(storageRoot);
    const hexHash = "a".repeat(40);

    await expect(cmdThreadStart(storageRoot, hexHash, "prompt", projectRoot)).rejects.toThrow();
  });
});

// ── Strategy 2: File Path Resolution ──────────────────────────────────────────

describe("Strategy 2: File Path Resolution", () => {
  test("should load workflow from absolute file path", async () => {
    await makeUwfStore(storageRoot);
    const yamlPath = join(tmpDir, "test-workflow.yaml");
    await writeFile(yamlPath, await createWorkflowYaml("test-workflow"));

    const result = await cmdThreadStart(storageRoot, yamlPath, "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    const uwf = await makeUwfStore(storageRoot);
    const node = uwf.store.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).name).toBe("test-workflow");
    }
  });

  test("should load workflow from relative file path", async () => {
    await makeUwfStore(storageRoot);
    const yamlPath = "test-workflow.yaml";
    await writeFile(join(projectRoot, yamlPath), await createWorkflowYaml("test-workflow"));

    const result = await cmdThreadStart(storageRoot, yamlPath, "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("should fail when file path does not exist", async () => {
    await makeUwfStore(storageRoot);

    await expect(
      cmdThreadStart(storageRoot, "./nonexistent.yaml", "prompt", projectRoot),
    ).rejects.toThrow();
  });

  test("should fail on invalid YAML syntax in file", async () => {
    await makeUwfStore(storageRoot);
    const yamlPath = join(tmpDir, "bad-syntax.yaml");
    await writeFile(yamlPath, "invalid: yaml: : :");

    await expect(cmdThreadStart(storageRoot, yamlPath, "prompt", projectRoot)).rejects.toThrow();
  });

  test("should fail on valid YAML with invalid WorkflowPayload shape", async () => {
    await makeUwfStore(storageRoot);
    const yamlPath = join(tmpDir, "invalid-workflow.yaml");
    await writeFile(yamlPath, "name: test\n# missing roles and graph");

    await expect(cmdThreadStart(storageRoot, yamlPath, "prompt", projectRoot)).rejects.toThrow();
  });

  test("should enforce filename matches workflow name", async () => {
    await makeUwfStore(storageRoot);
    const yamlPath = join(tmpDir, "solve-issue.yaml");
    await writeFile(yamlPath, await createWorkflowYaml("wrong-name"));

    await expect(cmdThreadStart(storageRoot, yamlPath, "prompt", projectRoot)).rejects.toThrow();
  });
});

// ── Strategy 3: Local Discovery (Parent Traversal) ────────────────────────────

describe("Strategy 3: Local Discovery", () => {
  test("should find workflow in current directory .workflow/", async () => {
    await makeUwfStore(storageRoot);
    const workflowDir = join(projectRoot, ".workflow");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(join(workflowDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    const uwf = await makeUwfStore(storageRoot);
    const node = uwf.store.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).name).toBe("solve-issue");
    }
  });

  test("should find workflow in parent directory .workflow/", async () => {
    await makeUwfStore(storageRoot);
    const workflowDir = join(projectRoot, ".workflow");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(join(workflowDir, "solve-issue.yaml"), await createWorkflowYaml("solve-issue"));

    const subdir = join(projectRoot, "packages", "cli-workflow", "src");
    await mkdir(subdir, { recursive: true });

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", subdir);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("should stop at filesystem root when traversing", async () => {
    await makeUwfStore(storageRoot);
    const deepPath = join(tmpDir, "deep", "path", "that", "does", "not", "have", "workflow");
    await mkdir(deepPath, { recursive: true });

    await expect(cmdThreadStart(storageRoot, "nonexistent", "prompt", deepPath)).rejects.toThrow();
  });

  test("should prefer .workflow/ over .workflows/ directory", async () => {
    await makeUwfStore(storageRoot);
    const workflowDir = join(projectRoot, ".workflow");
    const workflowsDir = join(projectRoot, ".workflows");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(workflowsDir, { recursive: true });

    await writeFile(
      join(workflowDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "1"),
    );
    await writeFile(
      join(workflowsDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "2"),
    );

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", projectRoot);

    const uwf = await makeUwfStore(storageRoot);
    const node = uwf.store.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).description).toBe("Test workflow (1)");
    }
  });

  test("should support .yml extension in local discovery", async () => {
    await makeUwfStore(storageRoot);
    const workflowDir = join(projectRoot, ".workflow");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(join(workflowDir, "solve-issue.yml"), await createWorkflowYaml("solve-issue"));

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });
});

// ── Strategy 4: Global Registry Fallback ──────────────────────────────────────

describe("Strategy 4: Global Registry Resolution", () => {
  test("should resolve workflow from global registry when not found locally", async () => {
    const uwf = await makeUwfStore(storageRoot);
    const hash = await storeWorkflow(uwf, "deploy-pipeline");
    const registry = await loadWorkflowRegistry(storageRoot);
    registry["deploy-pipeline"] = hash;
    await saveWorkflowRegistry(storageRoot, registry);

    const isolatedRoot = join(tmpDir, "isolated");
    await mkdir(isolatedRoot, { recursive: true });

    const result = await cmdThreadStart(storageRoot, "deploy-pipeline", "prompt", isolatedRoot);

    expect(result.workflow).toBe(hash);
  });

  test("should fail when workflow not found in any strategy", async () => {
    await makeUwfStore(storageRoot);

    await expect(cmdThreadStart(storageRoot, "nonexistent", "prompt", tmpDir)).rejects.toThrow();
  });
});

// ── Strategy Priority Order ───────────────────────────────────────────────────

describe("Resolution Priority", () => {
  test("should use explicit file path over local discovery", async () => {
    await makeUwfStore(storageRoot);

    // Setup: Create workflow in .workflow/ AND as explicit file
    const workflowDir = join(projectRoot, ".workflow");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "solve-issue.yaml"),
      await createWorkflowYaml("solve-issue", "discovery"),
    );

    const explicitPath = join(projectRoot, "custom-solve-issue.yaml");
    await writeFile(explicitPath, await createWorkflowYaml("custom-solve-issue", "explicit"));

    // Execute with explicit path
    const result = await cmdThreadStart(storageRoot, explicitPath, "prompt", projectRoot);

    const uwf = await makeUwfStore(storageRoot);
    const node = uwf.store.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).description).toBe("Test workflow (explicit)");
    }
  });

  test("should use local discovery over global registry", async () => {
    const uwf = await makeUwfStore(storageRoot);

    // Setup: Register globally
    const globalHash = await storeWorkflow(uwf, "solve-issue");
    const registry = await loadWorkflowRegistry(storageRoot);
    registry["solve-issue"] = globalHash;
    await saveWorkflowRegistry(storageRoot, registry);

    // Setup: Create local .workflow/
    const workflowDir = join(projectRoot, ".workflow");
    await mkdir(workflowDir, { recursive: true });
    const localYaml = await createWorkflowYaml("solve-issue", "local");
    await writeFile(join(workflowDir, "solve-issue.yaml"), localYaml);

    const result = await cmdThreadStart(storageRoot, "solve-issue", "prompt", projectRoot);

    const uwf2 = await makeUwfStore(storageRoot);
    const node = uwf2.store.get(result.workflow);
    expect(node).not.toBeNull();
    if (node !== null) {
      expect((node.payload as WorkflowPayload).description).toBe("Test workflow (local)");
    }
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  test("should treat '13-char-string.yaml' as file path, not CAS hash", async () => {
    await makeUwfStore(storageRoot);
    const fileName = "0123456789ABC.yaml"; // 13 chars + .yaml
    await writeFile(join(projectRoot, fileName), await createWorkflowYaml("0123456789ABC"));

    const result = await cmdThreadStart(storageRoot, fileName, "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("should handle workflow names containing slashes as file paths", async () => {
    await makeUwfStore(storageRoot);
    const filePath = "subdir/solve-issue.yaml";
    const fullPath = join(projectRoot, filePath);
    await mkdir(join(projectRoot, "subdir"), { recursive: true });
    await writeFile(fullPath, await createWorkflowYaml("solve-issue"));

    const result = await cmdThreadStart(storageRoot, filePath, "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("should handle absolute paths correctly", async () => {
    await makeUwfStore(storageRoot);
    const absPath = join(tmpDir, "abs-workflow.yaml");
    await writeFile(absPath, await createWorkflowYaml("abs-workflow"));

    const result = await cmdThreadStart(storageRoot, absPath, "prompt", projectRoot);

    expect(result.workflow).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("should fail on empty workflow ID", async () => {
    await makeUwfStore(storageRoot);

    await expect(cmdThreadStart(storageRoot, "", "prompt", projectRoot)).rejects.toThrow();
  });

  test("should fail on whitespace-only workflow ID", async () => {
    await makeUwfStore(storageRoot);

    await expect(cmdThreadStart(storageRoot, "   ", "prompt", projectRoot)).rejects.toThrow();
  });
});
