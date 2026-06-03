import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `uwf-test-global-cas-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    originalOcasDir = process.env.OCAS_DIR;
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
  });

  test("getGlobalCasDir returns default path when no env var set", () => {
    delete process.env.OCAS_DIR;
    const casDir = getGlobalCasDir();
    expect(casDir).toContain(".ocas");
  });

  test("getGlobalCasDir respects OCAS_DIR environment variable", () => {
    const customPath = join(tmpDir, "custom-cas");
    process.env.OCAS_DIR = customPath;
    const casDir = getGlobalCasDir();
    expect(casDir).toBe(customPath);
  });

  test("getGlobalCasDir ignores empty OCAS_DIR", () => {
    process.env.OCAS_DIR = "";
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
    process.env.OCAS_DIR = globalCasDir;

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
    process.env.OCAS_DIR = globalCasDir;

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
    process.env.OCAS_DIR = globalCasDir;

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
    const _hash = uwf1.store.cas.put(uwf1.schemas.text, JSON.stringify(testData));

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
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const uwf = await createUwfStore(storageRoot);
    const hash = await uwf.store.cas.put(uwf.schemas.text, "registry-test");
    saveWorkflowRegistry(uwf.varStore, "test-workflow", hash);

    const registry = loadWorkflowRegistry(uwf.varStore);
    expect(registry["test-workflow"]).toBe(hash);

    const { access } = await import("node:fs/promises");
    await access(join(globalCasDir, "vars"));

    const registryPath = join(storageRoot, "workflows.yaml");
    await expect(access(registryPath)).rejects.toThrow();
  });

  test("migrates workflows.yaml to variable store and renames file", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage-migrate");
    await mkdir(storageRoot, { recursive: true });

    const uwfSeed = await createUwfStore(storageRoot);
    const hash = await uwfSeed.store.cas.put(uwfSeed.schemas.text, "migrated-workflow");

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
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage-threads-migrate");
    await mkdir(storageRoot, { recursive: true });

    const threadId = "01JTEST0000000000000000AB" as ThreadId;
    const uwfSeed = await createUwfStore(storageRoot);
    const headHash = await uwfSeed.store.cas.put(uwfSeed.schemas.text, "migrated-thread-head");
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
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const threadId = "01JTEST000000000000000123" as ThreadId;
    const uwfSeed = await createUwfStore(storageRoot);
    const headHash = await uwfSeed.store.cas.put(uwfSeed.schemas.text, "hash-456");
    setThread(uwfSeed.varStore, threadId, createThreadIndexEntry(headHash));

    const uwf = await createUwfStore(storageRoot);
    const entry = uwf.varStore.list({ exactName: `@uwf/thread/${threadId}` })[0];
    expect(entry?.value).toBe(headHash);

    const { readFile } = await import("node:fs/promises");
    const threadsPath = join(storageRoot, "threads.yaml");
    await expect(readFile(threadsPath, "utf8")).rejects.toThrow();
  });

  test("history is stored in global CAS variable store", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const uwf = await createUwfStore(storageRoot);
    const threadId = "thread-123" as ThreadId;
    const headHash = await uwf.store.cas.put(uwf.schemas.text, "history-head");
    const { addHistoryEntry, findHistoryEntry } = await import("../store.js");
    addHistoryEntry(uwf.varStore, {
      thread: threadId,
      workflow: "workflow-456",
      head: headHash,
      completedAt: Date.now(),
      reason: "completed",
    });

    const entry = findHistoryEntry(uwf.varStore, threadId);
    expect(entry?.thread).toBe(threadId);
    expect(entry?.workflow).toBe("workflow-456");
    expect(entry?.head).toBe(headHash);

    const { access } = await import("node:fs/promises");
    await access(join(globalCasDir, "vars"));

    const historyPath = join(storageRoot, "history.jsonl");
    await expect(access(historyPath)).rejects.toThrow();
  });

  test("migrates history.jsonl to variable store and renames file", async () => {
    const globalCasDir = join(tmpDir, "global-cas-history");
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage-history-migrate");
    await mkdir(storageRoot, { recursive: true });

    const threadId = "01JTEST0000000000000000CD" as ThreadId;
    const uwfSeed = await createUwfStore(storageRoot);
    const workflowHash = await uwfSeed.store.cas.put(uwfSeed.schemas.text, "migrated-workflow");
    const headHash = await uwfSeed.store.cas.put(uwfSeed.schemas.text, "migrated-head");
    const completedAt = 1780410000000;
    const { writeFile, access, readFile } = await import("node:fs/promises");
    const historyPath = join(storageRoot, "history.jsonl");
    await writeFile(
      historyPath,
      `${JSON.stringify({
        thread: threadId,
        workflow: workflowHash,
        head: headHash,
        completedAt,
        reason: "cancelled",
      })}\n`,
      "utf8",
    );

    const uwf = await createUwfStore(storageRoot);
    const { findHistoryEntry } = await import("../store.js");
    const entry = findHistoryEntry(uwf.varStore, threadId);
    expect(entry).toEqual({
      thread: threadId,
      workflow: workflowHash,
      head: headHash,
      completedAt,
      reason: "cancelled",
    });

    await expect(access(historyPath)).rejects.toThrow();
    const migratedContent = await readFile(`${historyPath}.migrated`, "utf8");
    expect(migratedContent).toContain(threadId);
    expect(migratedContent).toContain(workflowHash);
  });

  test("CAS nodes are stored in global directory", async () => {
    const globalCasDir = join(tmpDir, "global-cas");
    process.env.OCAS_DIR = globalCasDir;

    const storageRoot = join(tmpDir, "storage");
    await mkdir(storageRoot, { recursive: true });

    const uwf = await createUwfStore(storageRoot);

    // Store a CAS node
    const testPayload = JSON.stringify({ test: "node" });
    const _hash = uwf.store.cas.put(uwf.schemas.text, testPayload);

    // Verify the node is in global CAS directory
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(globalCasDir);
    expect(files.length).toBeGreaterThan(0);

    // Verify the node is NOT in the old storageRoot/cas location
    const oldCasDir = join(storageRoot, "cas");
    await expect(readdir(oldCasDir)).rejects.toThrow();
  });
});
