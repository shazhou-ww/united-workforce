import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore, getContentMerklePayload } from "@uncaged/workflow-cas";
import { FORK_BRANCH_ROLE, walkStateFramesNewestFirst } from "@uncaged/workflow-execute";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";

import { cmdFork, cmdRun } from "../src/commands/thread/index.js";
import { cmdAdd } from "../src/commands/workflow/index.js";
import { pathExists } from "../src/fs-utils.js";
import { resolveThreadRecord } from "../src/thread-scan.js";
import { addCliArgs } from "./bundle-fixture.js";
import { ensureTestWorkflowRegistryConfig } from "./workflow-registry-fixture.js";

/** Three-role workflow that respects `input.steps` for fork/resume. */
const threeRoleBundleSource = `import { putContentMerkleNode } from "@uncaged/workflow-cas";

export const descriptor = {
  description: "fork-cli",
  roles: {
    planner: { description: "planner", schema: {} },
    coder: { description: "coder", schema: {} },
    reviewer: { description: "reviewer", schema: {} },
  },
};
export const run = async function* (input, options) {
  const cas = options.cas;
  const has = (r) => input.steps.some((s) => s.role === r);
  if (!has("planner")) {
    const h = await putContentMerkleNode(cas, "p1");
    yield { role: "planner", contentHash: h, meta: { k: "planner" }, refs: [h] };
  }
  if (!has("coder")) {
    const h = await putContentMerkleNode(cas, "c1");
    yield { role: "coder", contentHash: h, meta: { k: "coder" }, refs: [h] };
  }
  if (!has("reviewer")) {
    const body = "rev-" + String(input.steps.length);
    const h = await putContentMerkleNode(cas, body);
    yield { role: "reviewer", contentHash: h, meta: { k: "reviewer" }, refs: [h] };
  }
  return { returnCode: 0, summary: "done" };
};
`;

async function waitUntilRunningAbsent(runningPath: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!(await pathExists(runningPath))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitUntilThreadCompletes(storageRoot: string, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const row = await resolveThreadRecord(storageRoot, threadId);
    if (row?.source === "history") {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function listMeaningfulRoleContents(
  storageRoot: string,
  threadId: string,
): Promise<Array<{ role: string; content: string }>> {
  const row = await resolveThreadRecord(storageRoot, threadId);
  if (row === null) {
    return [];
  }
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const frames = await walkStateFramesNewestFirst(cas, row.head);
  const chronological = [...frames].reverse();
  const out: Array<{ role: string; content: string }> = [];
  for (const fr of chronological) {
    if (fr.payload.role === END || fr.payload.role === FORK_BRANCH_ROLE) {
      continue;
    }
    const content = await getContentMerklePayload(cas, fr.payload.content);
    out.push({
      role: fr.payload.role,
      content: content ?? "",
    });
  }
  return out;
}

describe("cli fork", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-fork-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = storageRoot;
    await ensureTestWorkflowRegistryConfig(storageRoot);
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("fork --from-role planner continues with coder then reviewer", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, threeRoleBundleSource, "utf8");

    const added = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const hash = added.value.hash;

    const ran = await cmdRun(storageRoot, "solve-issue", "hello", 5);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const sourceId = ran.value.threadId;
    const sourceRunning = join(storageRoot, "logs", hash, `${sourceId}.running`);
    await waitUntilRunningAbsent(sourceRunning);
    await waitUntilThreadCompletes(storageRoot, sourceId);

    const histBefore = await resolveThreadRecord(storageRoot, sourceId);
    expect(histBefore?.source).toBe("history");

    const forked = await cmdFork(storageRoot, sourceId, "planner");
    expect(forked.ok).toBe(true);
    if (!forked.ok) {
      return;
    }
    const newId = forked.value.threadId;
    const newRunning = join(storageRoot, "logs", hash, `${newId}.running`);
    await waitUntilRunningAbsent(newRunning);
    await waitUntilThreadCompletes(storageRoot, newId);

    const forkHist = await resolveThreadRecord(storageRoot, newId);
    expect(forkHist?.source).toBe("history");
    expect(forkHist?.start).toBe(histBefore?.start);

    const steps = await listMeaningfulRoleContents(storageRoot, newId);
    const tail = steps[steps.length - 1];
    expect(tail?.role).toBe("reviewer");
    expect(tail?.content).toBe("rev-1");
  });

  test("fork without --from-role retries last role", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, threeRoleBundleSource, "utf8");

    const added = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const hash = added.value.hash;

    const ran = await cmdRun(storageRoot, "solve-issue", "hello", 5);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const sourceId = ran.value.threadId;
    await waitUntilRunningAbsent(join(storageRoot, "logs", hash, `${sourceId}.running`));
    await waitUntilThreadCompletes(storageRoot, sourceId);

    const forked = await cmdFork(storageRoot, sourceId, null);
    expect(forked.ok).toBe(true);
    if (!forked.ok) {
      return;
    }
    const newId = forked.value.threadId;
    await waitUntilRunningAbsent(join(storageRoot, "logs", hash, `${newId}.running`));
    await waitUntilThreadCompletes(storageRoot, newId);

    const steps = await listMeaningfulRoleContents(storageRoot, newId);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    const coderReplay = steps[steps.length - 2];
    expect(coderReplay?.role).toBe("coder");
    expect(coderReplay?.content).toBe("c1");
    const tail = steps[steps.length - 1];
    expect(tail?.role).toBe("reviewer");
    expect(tail?.content).toBe("rev-2");
  });

  test("fork rejects unknown role with available names", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, threeRoleBundleSource, "utf8");

    const added = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }

    const ran = await cmdRun(storageRoot, "solve-issue", "hello", 5);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const sourceId = ran.value.threadId;
    await waitUntilRunningAbsent(
      join(storageRoot, "logs", added.value.hash, `${sourceId}.running`),
    );
    await waitUntilThreadCompletes(storageRoot, sourceId);

    const bad = await cmdFork(storageRoot, sourceId, "ghost-role");
    expect(bad.ok).toBe(false);
    if (bad.ok) {
      return;
    }
    expect(bad.error).toContain("ghost-role");
    expect(bad.error).toContain("planner");
  });
});
