import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getDefaultStorageRoot,
  getGlobalCasDir,
  migrateStorageIfNeeded,
  resolveStorageRoot,
} from "../store.js";

describe("Storage root resolution", () => {
  const envKeys = ["UWF_STORAGE_ROOT", "WORKFLOW_STORAGE_ROOT", "OCAS_DIR"] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  test("getDefaultStorageRoot returns ~/.uwf", () => {
    expect(getDefaultStorageRoot()).toBe(join(homedir(), ".uwf"));
  });

  test("resolveStorageRoot prefers UWF_STORAGE_ROOT", () => {
    process.env.UWF_STORAGE_ROOT = "/tmp/uwf-primary";
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/uwf-fallback";
    expect(resolveStorageRoot()).toBe("/tmp/uwf-primary");
  });

  test("resolveStorageRoot falls back to WORKFLOW_STORAGE_ROOT", () => {
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/uwf-fallback";
    expect(resolveStorageRoot()).toBe("/tmp/uwf-fallback");
  });

  test("getGlobalCasDir returns ~/.ocas by default", () => {
    const casDir = getGlobalCasDir();
    expect(casDir).toBe(join(homedir(), ".ocas"));
  });

  test("getGlobalCasDir respects OCAS_DIR", () => {
    process.env.OCAS_DIR = "/tmp/ocas-primary";
    expect(getGlobalCasDir()).toBe("/tmp/ocas-primary");
  });
});

describe("migrateStorageIfNeeded", () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = join(
      homedir(),
      `.uwf-migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(fakeHome, { recursive: true });
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true });
  });

  test("creates symlinks from legacy paths when new paths are missing", async () => {
    const oldWorkflow = join(fakeHome, ".uncaged", "workflow");
    const oldCas = join(fakeHome, ".uncaged", "json-cas");
    await mkdir(oldWorkflow, { recursive: true });
    await mkdir(oldCas, { recursive: true });
    await writeFile(join(oldWorkflow, "config.yaml"), "defaultAgent: test\n", "utf8");

    migrateStorageIfNeeded(fakeHome);

    const newWorkflow = join(fakeHome, ".uwf");
    const newCas = join(fakeHome, ".ocas");
    const workflowStat = await lstat(newWorkflow);
    const casStat = await lstat(newCas);
    expect(workflowStat.isSymbolicLink()).toBe(true);
    expect(casStat.isSymbolicLink()).toBe(true);
  });

  test("skips migration when new paths already exist", async () => {
    const oldWorkflow = join(fakeHome, ".uncaged", "workflow");
    const newWorkflow = join(fakeHome, ".uwf");
    await mkdir(oldWorkflow, { recursive: true });
    await mkdir(newWorkflow, { recursive: true });

    migrateStorageIfNeeded(fakeHome);

    const stat = await lstat(newWorkflow);
    expect(stat.isDirectory()).toBe(true);
  });
});
