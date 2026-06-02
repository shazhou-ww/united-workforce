import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createThreadIndexEntry, type ThreadId } from "@united-workforce/protocol";
import {
  createUwfStore,
  getCasDir,
  getGlobalCasDir,
  getRegistryPath,
  loadWorkflowRegistry,
  saveWorkflowRegistry,
  setThread,
} from "../store.js";

describe("Global CAS directory", () => {
  let tmpDir: string;
  let originalOcasDir: string | undefined;
  let originalLegacyCasDir: string | undefined;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `uwf-test-global-cas-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    originalOcasDir = process.env.OCAS_DIR;
    originalLegacyCasDir = process.env.UNCAGED_CAS_DIR;
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    if (originalOcasDir === undefined) {
      delete process.env.OCAS_DIR;
    } else {
      process.env.OCAS_DIR = originalOcasDir;
    }
    if (originalLegacyCasDir === undefined) {
      delete process.env.UNCAGED_CAS_DIR;
    } else {
      process.env.UNCAGED_CAS_DIR = originalLegacyCasDir;
    }
  });

  test("getGlobalCasDir returns default path when no env var set", () => {
    delete process.env.OCAS_DIR;
    delete process.env.UNCAGED_CAS_DIR;
    const casDir = getGlobalCasDir();
    expect(casDir).toContain(".ocas");
  });

  test("getGlobalCasDir respects OCAS_DIR environment variable", () => {
    const customPath = join(tmpDir, "custom-cas");
    process.env.OCAS_DIR = customPath;
    const casDir = getGlobalCasDir();
    expect(casDir).toBe(customPath);
  });

  test("getGlobalCasDir respects UNCAGED_CAS_DIR environment variable", () => {
    const customPath = join(tmpDir, "legacy-cas");
    process.env.UNCAGED_CAS_DIR = customPath;
    const casDir = getGlobalCasDir();
    expect(casDir).toBe(customPath);
  });

  test("getGlobalCasDir prefers OCAS_DIR over UNCAGED_CAS_DIR", () => {
    process.env.OCAS_DIR = join(tmpDir, "primary-cas");
    process.env.UNCAGED_CAS_DIR = join(tmpDir, "legacy-cas");
    expect(getGlobalCasDir()).toBe(join(tmpDir, "primary-cas"));
  });

  test("getGlobalCasDir ignores empty OCAS_DIR", () => {
    process.env.OCAS_DIR = "";
    delete process.env.UNCAGED_CAS_DIR;
    const casDir = getGlobalCasDir();
    expect(casDir).toContain(".ocas");
  });

  test("getCasDir is deprecated but still works for backward compatibility", () => {
    const storageRoot = join(tmpDir, "storage");
    const casDir = getCasDir(storageRoot);
    expect(casDir).toBe(join(storageRoot, "cas"));
  });

  test("createUwfStore uses global CAS directory", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const uwf = await createUwfStore(storageRoot);

    // Verify the store was created in the global CAS directory
    expect(uwf.storageRoot).toBe(storageRoot);
    expect(uwf.store).toBeDefined();
    expect(uwf.schemas).toBeDefined();
    expect(uwf.varStore).toBeDefined();

    // The global CAS directory should be created
    const { stat } = await import("node:fs/promises");
    const stats = await stat(globalCasDir);
    expect(stats.isDirectory()).toBe(true);
  });

  test("createUwfStore creates global CAS directory if it does not exist", async () => {
    const globalCasDir = join(tmpDir, "new-global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    await createUwfStore(storageRoot);

    // Verify the directory was created
    const { stat } = await import("node:fs/promises");
    const stats = await stat(globalCasDir);
    expect(stats.isDirectory()).toBe(true);
  });

  test("multiple uwfStore instances share the same global CAS filesystem", async () => {
    const globalCasDir = join(tmpDir, "shared-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot1 = join(tmpDir, "storage1");
    const storageRoot2 = join(tmpDir, "storage2");
    await mkdir(storageRoot1, { recursive: true });
    await mkdir(storageRoot2, { recursive: true });

    const uwf1 = await createUwfStore(storageRoot1);
    const uwf2 = await createUwfStore(storageRoot2);

    // Both should use the same global CAS directory
    expect(uwf1.store).toBeDefined();
    expect(uwf2.store).toBeDefined();

    // Store a node in the first store
    const testData = { test: "data" };
    const _hash = uwf1.store.put(uwf1.schemas.text, JSON.stringify(testData));

    // Both stores share the same CAS filesystem directory
    // Since schemas are registered idempotently, they should have the same hash
    expect(uwf2.schemas.text).toBe(uwf1.schemas.text);

    // Verify the CAS files are written to the shared directory
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(globalCasDir);
    expect(files.length).toBeGreaterThan(0);
  });

  test("workflow registry is stored in global CAS variable store", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const uwf = await createUwfStore(storageRoot);
    const hash = await uwf.store.put(uwf.schemas.text, "registry-test");
    saveWorkflowRegistry(uwf.varStore, "test-workflow", hash);

    const registry = loadWorkflowRegistry(uwf.varStore);
    expect(registry["test-workflow"]).toBe(hash);

    const { access } = await import("node:fs/promises");
    await access(join(globalCasDir, "variables.db"));

    const registryPath = join(storageRoot, "workflows.yaml");
    await expect(access(registryPath)).rejects.toThrow();
  });

  test("migrates workflows.yaml to variable store and renames file", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage-migrate");
    await mkdir(storageRoot, { recursive: true });

    const uwfSeed = await createUwfStore(storageRoot);
    const hash = await uwfSeed.store.put(uwfSeed.schemas.text, "migrated-workflow");

    const registryPath = getRegistryPath(storageRoot);
    const { writeFile, access, readFile } = await import("node:fs/promises");
    await writeFile(registryPath, `migrated-workflow: ${hash}\n`, "utf8");

    const uwf = await createUwfStore(storageRoot);
    const registry = loadWorkflowRegistry(uwf.varStore);
    expect(registry["migrated-workflow"]).toBe(hash);

    await expect(access(registryPath)).rejects.toThrow();
    const migratedPath = `${registryPath}.migrated`;
    const migratedContent = await readFile(migratedPath, "utf8");
    expect(migratedContent).toContain("migrated-workflow");
    expect(migratedContent).toContain(hash);
  });

  test("migrates threads.yaml to variable store and renames file", async () => {
    const globalCasDir = join(tmpDir, "global-cas-threads");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage-threads-migrate");
    await mkdir(storageRoot, { recursive: true });

    const threadId = "01JTEST0000000000000000AB" as ThreadId;
    const uwfSeed = await createUwfStore(storageRoot);
    const headHash = await uwfSeed.store.put(uwfSeed.schemas.text, "migrated-thread-head");
    const { writeFile, access, readFile } = await import("node:fs/promises");
    const threadsPath = join(storageRoot, "threads.yaml");
    await writeFile(threadsPath, `${threadId}: ${headHash}\n`, "utf8");

    const uwf = await createUwfStore(storageRoot);
    const entry = uwf.varStore.list({ exactName: `@uwf/thread/${threadId}` })[0];
    expect(entry?.value).toBe(headHash);

    await expect(access(threadsPath)).rejects.toThrow();
    const migratedContent = await readFile(`${threadsPath}.migrated`, "utf8");
    expect(migratedContent).toContain(threadId);
    expect(migratedContent).toContain(headHash);
  });

  test("thread metadata stored in ocas variable store", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const threadId = "01JTEST000000000000000123" as ThreadId;
    const uwfSeed = await createUwfStore(storageRoot);
    const headHash = await uwfSeed.store.put(uwfSeed.schemas.text, "hash-456");
    setThread(uwfSeed.varStore, threadId, createThreadIndexEntry(headHash));

    const uwf = await createUwfStore(storageRoot);
    const entry = uwf.varStore.list({ exactName: `@uwf/thread/${threadId}` })[0];
    expect(entry?.value).toBe(headHash);

    const { readFile } = await import("node:fs/promises");
    const threadsPath = join(storageRoot, "threads.yaml");
    await expect(readFile(threadsPath, "utf8")).rejects.toThrow();
  });

  test("history remains in storageRoot", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    await createUwfStore(storageRoot);

    // Write history
    const { appendThreadHistory } = await import("../store.js");
    await appendThreadHistory(storageRoot, {
      thread: "thread-123" as any,
      workflow: "workflow-456",
      head: "hash-789",
      completedAt: Date.now(),
      reason: "completed",
    });

    // Verify history.jsonl is in storageRoot, not global CAS
    const { readFile } = await import("node:fs/promises");
    const historyPath = join(storageRoot, "history.jsonl");
    const content = await readFile(historyPath, "utf8");
    expect(content).toContain("thread-123");
    expect(content).toContain("workflow-456");

    // Verify history.jsonl is NOT in global CAS directory
    const globalHistoryPath = join(globalCasDir, "history.jsonl");
    await expect(readFile(globalHistoryPath, "utf8")).rejects.toThrow();
  });

  test("CAS nodes are stored in global directory", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.UNCAGED_CAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const uwf = await createUwfStore(storageRoot);

    // Store a CAS node
    const testPayload = JSON.stringify({ test: "node" });
    const _hash = uwf.store.put(uwf.schemas.text, testPayload);

    // Verify the node is in global CAS directory
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(globalCasDir);
    expect(files.length).toBeGreaterThan(0);

    // Verify the node is NOT in the old storageRoot/cas location
    const oldCasDir = join(storageRoot, "cas");
    await expect(readdir(oldCasDir)).rejects.toThrow();
  });
});
