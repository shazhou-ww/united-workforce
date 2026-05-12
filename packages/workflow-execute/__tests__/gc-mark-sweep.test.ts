import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCasStore,
  putContentNodeWithRefs,
  putStartNode,
  putStateNode,
} from "@uncaged/workflow-cas";
import type { StateNodePayload } from "@uncaged/workflow-protocol";

import { FORK_BRANCH_ROLE } from "../src/engine/fork-thread.js";
import { garbageCollectCas } from "../src/engine/gc.js";
import { getBundleDir, removeThreadEntry, upsertThreadEntry } from "../src/engine/threads-index.js";

describe("garbageCollectCas (mark-and-sweep)", () => {
  let storageRoot: string;
  let casDir: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-gc-ms-"));
    casDir = join(storageRoot, "cas");
    await mkdir(casDir, { recursive: true });
    await writeFile(
      join(storageRoot, "workflow.yaml"),
      "config:\n  maxDepth: 1\n  supervisorInterval: 0\n  providers: {}\n  models: {}\nworkflows: {}\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("shared CAS prefix survives when one fork thread index entry is removed", async () => {
    const bundleHash = "TESTGC0000001";
    const bundleDir = getBundleDir(storageRoot, bundleHash);
    await mkdir(bundleDir, { recursive: true });

    const cas = createCasStore(casDir);
    const promptHash = await cas.put("prompt");
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

    const c1 = await putContentNodeWithRefs(cas, "p1", []);
    const h1 = await putStateNode(cas, {
      role: "planner",
      meta: {},
      start: startHash,
      content: c1,
      ancestors: [],
      compact: null,
      timestamp: 1,
      childThread: null,
    } satisfies StateNodePayload);

    const c2 = await putContentNodeWithRefs(cas, "c1", []);
    const h2 = await putStateNode(cas, {
      role: "coder",
      meta: {},
      start: startHash,
      content: c2,
      ancestors: [h1],
      compact: null,
      timestamp: 2,
      childThread: null,
    } satisfies StateNodePayload);

    const ec = await putContentNodeWithRefs(cas, "", []);
    const fm = await putStateNode(cas, {
      role: FORK_BRANCH_ROLE,
      meta: {},
      start: startHash,
      content: ec,
      ancestors: [h1],
      compact: null,
      timestamp: 3,
      childThread: null,
    } satisfies StateNodePayload);

    await upsertThreadEntry(bundleDir, "THREAD_AAAAAAA", {
      head: h2,
      start: startHash,
      updatedAt: 10,
    });
    await upsertThreadEntry(bundleDir, "THREAD_BBBBBBB", {
      head: fm,
      start: startHash,
      updatedAt: 20,
    });

    await removeThreadEntry(bundleDir, "THREAD_AAAAAAA");

    const gc = await garbageCollectCas(storageRoot);
    expect(gc.ok).toBe(true);
    if (!gc.ok) {
      return;
    }

    expect(await cas.get(h2)).toBeNull();
    expect(await cas.get(h1)).not.toBeNull();
    expect(await cas.get(startHash)).not.toBeNull();
    expect(await cas.get(promptHash)).not.toBeNull();
    expect(await cas.get(fm)).not.toBeNull();
  });
});
