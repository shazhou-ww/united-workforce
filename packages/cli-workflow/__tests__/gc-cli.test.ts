import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCasStore, putStartNode } from "@uncaged/workflow-cas";
import { garbageCollectCas, getBundleDir, upsertThreadEntry } from "@uncaged/workflow-execute";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { cmdThreadRemove } from "../src/commands/thread/index.js";
import { pathExists } from "../src/fs-utils.js";

const cliEntryPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

describe("gc cli and garbageCollectCas", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-gc-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = storageRoot;
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("garbageCollectCas keeps CAS entries reachable from threads.json roots", async () => {
    const bundleHash = "C9NMV6V2TQT81";
    const threadId = "01AAA1111111111111111111";
    const bundleDir = getBundleDir(storageRoot, bundleHash);
    await mkdir(bundleDir, { recursive: true });

    const cas = createCasStore(getGlobalCasDir(storageRoot));
    const orphanHash = await cas.put("orphan-blob");
    const promptHash = await cas.put("prompt-text");
    const startHash = await putStartNode(
      cas,
      {
        name: "demo",
        hash: bundleHash,
        depth: 0,
        parentState: null,
      },
      promptHash,
    );

    await upsertThreadEntry(bundleDir, threadId, {
      head: startHash,
      start: startHash,
      updatedAt: 100,
    });

    const gc = await garbageCollectCas(storageRoot);
    expect(gc.ok).toBe(true);
    if (!gc.ok) {
      return;
    }
    expect(gc.value.scannedThreads).toBe(2);
    expect(gc.value.deletedEntries).toBe(1);
    expect(gc.value.deletedHashes).toEqual([orphanHash]);

    expect(await pathExists(join(getGlobalCasDir(storageRoot), `${promptHash}.txt`))).toBe(true);
    expect(await pathExists(join(getGlobalCasDir(storageRoot), `${startHash}.txt`))).toBe(true);
    expect(await pathExists(join(getGlobalCasDir(storageRoot), `${orphanHash}.txt`))).toBe(false);
  });

  test("garbageCollectCas deletes orphaned CAS when no threads reference them", async () => {
    const cas = createCasStore(getGlobalCasDir(storageRoot));
    const orphanHash = await cas.put("lonely");

    const gc = await garbageCollectCas(storageRoot);
    expect(gc.ok).toBe(true);
    if (!gc.ok) {
      return;
    }
    expect(gc.value.scannedThreads).toBe(0);
    expect(gc.value.activeRefs).toBe(0);
    expect(gc.value.deletedEntries).toBe(1);
    expect(gc.value.deletedHashes).toEqual([orphanHash]);
    expect(await pathExists(join(getGlobalCasDir(storageRoot), `${orphanHash}.txt`))).toBe(false);
  });

  test("cli gc prints stats", async () => {
    const bundleHash = "C9NMV6V2TQT81";
    const threadId = "01BBB2222222222222222222";
    const bundleDir = getBundleDir(storageRoot, bundleHash);
    await mkdir(bundleDir, { recursive: true });

    const cas = createCasStore(getGlobalCasDir(storageRoot));
    const promptHash = await cas.put("prompt-text");
    const startHash = await putStartNode(
      cas,
      {
        name: "demo",
        hash: bundleHash,
        depth: 0,
        parentState: null,
      },
      promptHash,
    );
    await cas.put("drop-me");

    await upsertThreadEntry(bundleDir, threadId, {
      head: startHash,
      start: startHash,
      updatedAt: 100,
    });

    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: storageRoot };
    const proc = spawnSync(process.execPath, [cliEntryPath, "cas", "gc"], {
      env,
      encoding: "utf8",
    });
    expect(proc.status).toBe(0);
    expect(String(proc.stdout).trim()).toBe("scanned 2 threads, 2 active refs, deleted 1 entries");
  });

  test("thread rm triggers gc so unreferenced CAS is removed", async () => {
    const bundleHash = "C9NMV6V2TQT81";
    const threadId = "01CCC3333333333333333333";
    const bundleDir = getBundleDir(storageRoot, bundleHash);
    await mkdir(bundleDir, { recursive: true });

    const cas = createCasStore(getGlobalCasDir(storageRoot));
    const promptHash = await cas.put("prompt-text");
    const startHash = await putStartNode(
      cas,
      {
        name: "demo",
        hash: bundleHash,
        depth: 0,
        parentState: null,
      },
      promptHash,
    );

    await upsertThreadEntry(bundleDir, threadId, {
      head: startHash,
      start: startHash,
      updatedAt: 100,
    });

    const orphanHash = await cas.put("orphan-after-rm");
    const orphanPath = join(getGlobalCasDir(storageRoot), `${orphanHash}.txt`);

    const removed = await cmdThreadRemove(storageRoot, threadId);
    expect(removed.ok).toBe(true);

    expect(await pathExists(orphanPath)).toBe(false);
    expect(await pathExists(join(getGlobalCasDir(storageRoot), `${promptHash}.txt`))).toBe(false);
  });
});
