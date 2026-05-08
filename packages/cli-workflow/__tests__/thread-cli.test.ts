import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getGlobalCasDir } from "@uncaged/workflow";
import { cmdCasPut } from "../src/commands/cas/index.js";
import {
  cmdKill,
  cmdPause,
  cmdPs,
  cmdResume,
  cmdRun,
  cmdThreadRemove,
  cmdThreadShow,
  cmdThreads,
} from "../src/commands/thread/index.js";
import { cmdAdd } from "../src/commands/workflow/index.js";
import { pathExists, readTextFileIfExists } from "../src/fs-utils.js";
import { addCliArgs } from "./bundle-fixture.js";
import { ensureTestWorkflowRegistryConfig } from "./workflow-registry-fixture.js";

const wfPutImport = `import { putContentMerkleNode } from "@uncaged/workflow";
`;

const threadFixtureDescriptor = `export const descriptor = {
  description: "thread-cli",
  roles: {
    planner: { description: "planner", schema: {} },
    coder: { description: "coder", schema: {} },
    first: { description: "first", schema: {} },
    second: { description: "second", schema: {} },
    only: { description: "only", schema: {} },
    noop: { description: "noop", schema: {} },
  },
};
`;

const fastBundleSource = `${threadFixtureDescriptor}
${wfPutImport}
export const run = async function* (input, options) {
  const cas = options.cas;
  let h = await putContentMerkleNode(cas, "plan");
  yield { role: "planner", contentHash: h, meta: { plan: input.prompt }, refs: [h] };
  h = await putContentMerkleNode(cas, "code");
  yield { role: "coder", contentHash: h, meta: { diff: "y" }, refs: [h] };
  return { returnCode: 0, summary: "done" };
};
`;

const slowPlannerBundleSource = `${threadFixtureDescriptor}
${wfPutImport}
export const run = async function* (input, options) {
  await new Promise((r) => setTimeout(r, 400));
  const cas = options.cas;
  let h = await putContentMerkleNode(cas, "plan");
  yield { role: "planner", contentHash: h, meta: { plan: input.prompt }, refs: [h] };
  h = await putContentMerkleNode(cas, "code");
  yield { role: "coder", contentHash: h, meta: { diff: "y" }, refs: [h] };
  return { returnCode: 0, summary: "done" };
};
`;

const cliEntryPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const abortablePlannerBundleSource = `${threadFixtureDescriptor}
${wfPutImport}
export const run = async function* (input, options) {
  await new Promise((r) => setTimeout(r, 600));
  const cas = options.cas;
  let h = await putContentMerkleNode(cas, "plan");
  yield { role: "planner", contentHash: h, meta: { plan: input.prompt }, refs: [h] };
  h = await putContentMerkleNode(cas, "code");
  yield { role: "coder", contentHash: h, meta: { diff: "y" }, refs: [h] };
  return { returnCode: 0, summary: "done" };
};
`;

const pauseResumeBundleSource = `${threadFixtureDescriptor}
${wfPutImport}
export const run = async function* (_input, options) {
  const cas = options.cas;
  let h = await putContentMerkleNode(cas, "f");
  yield { role: "first", contentHash: h, meta: {}, refs: [h] };
  await new Promise((r) => setTimeout(r, 1500));
  h = await putContentMerkleNode(cas, "s");
  yield { role: "second", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "done" };
};
`;

const delayedFirstYieldBundleSource = `${threadFixtureDescriptor}
${wfPutImport}
export const run = async function* (_input, options) {
  await new Promise((r) => setTimeout(r, 900));
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "x");
  yield { role: "only", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "done" };
};
`;

async function countDataJsonlLines(dataPath: string): Promise<number> {
  try {
    const text = await readFile(dataPath, "utf8");
    return text
      .trim()
      .split("\n")
      .filter((l) => l !== "").length;
  } catch {
    return 0;
  }
}

async function waitUntilMinDataLines(
  dataPath: string,
  minLines: number,
  maxAttempts: number,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if ((await countDataJsonlLines(dataPath)) >= minLines) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitUntilRunningFileAbsent(runningPath: string, maxAttempts: number): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!(await pathExists(runningPath))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("cli thread commands", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-thread-"));
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

  test("run / threads / thread / thread rm", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, fastBundleSource, "utf8");

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

    const threadId = ran.value.threadId;

    let threads = await cmdThreads(storageRoot, []);
    for (
      let attempt = 0;
      attempt < 50 && threads.ok && !threads.value.some((l) => l.includes(threadId));
      attempt++
    ) {
      await new Promise((r) => setTimeout(r, 20));
      threads = await cmdThreads(storageRoot, []);
    }
    expect(threads.ok).toBe(true);
    if (!threads.ok) {
      return;
    }
    expect(threads.value.some((l) => l.includes(threadId))).toBe(true);

    const shown = await cmdThreadShow(storageRoot, threadId);
    expect(shown.ok).toBe(true);
    if (!shown.ok) {
      return;
    }
    expect(shown.value.includes('"threadId"')).toBe(true);

    const removed = await cmdThreadRemove(storageRoot, threadId);
    expect(removed.ok).toBe(true);

    const dataPath = join(storageRoot, "logs", added.value.hash, `${threadId}.data.jsonl`);
    expect(await pathExists(dataPath)).toBe(false);
  });

  test("thread rm runs GC and removes CAS blobs not referenced by any remaining thread", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, fastBundleSource, "utf8");

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

    const threadId = ran.value.threadId;

    let threads = await cmdThreads(storageRoot, []);
    for (
      let attempt = 0;
      attempt < 50 && threads.ok && !threads.value.some((l) => l.includes(threadId));
      attempt++
    ) {
      await new Promise((r) => setTimeout(r, 20));
      threads = await cmdThreads(storageRoot, []);
    }

    const dataPath = join(storageRoot, "logs", added.value.hash, `${threadId}.data.jsonl`);
    const runningPath = join(dirname(dataPath), `${threadId}.running`);
    await waitUntilRunningFileAbsent(runningPath, 120);

    const put = await cmdCasPut(storageRoot, "keep-after-thread-rm");
    expect(put.ok).toBe(true);
    if (!put.ok) {
      return;
    }
    const hash = put.value;
    const casBlob = join(getGlobalCasDir(storageRoot), `${hash}.txt`);

    const removed = await cmdThreadRemove(storageRoot, threadId);
    expect(removed.ok).toBe(true);

    const stillThere = await readTextFileIfExists(casBlob);
    expect(stillThere).toBeNull();
  });

  test("cli entrypoint dispatches threads / ps (spawn)", () => {
    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: storageRoot };
    const threads = spawnSync(process.execPath, [cliEntryPath, "thread", "list"], {
      env,
      encoding: "utf8",
    });
    expect(threads.status).toBe(0);

    const ps = spawnSync(process.execPath, [cliEntryPath, "thread", "ps"], {
      env,
      encoding: "utf8",
    });
    expect(ps.status).toBe(0);
  });

  test("ps lists running threads while planner role is in-flight", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, slowPlannerBundleSource, "utf8");

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

    const threadId = ran.value.threadId;

    await new Promise((r) => setTimeout(r, 50));
    const psEarly = await cmdPs(storageRoot);
    expect(psEarly.some((l) => l.includes(threadId))).toBe(true);

    await new Promise((r) => setTimeout(r, 900));

    const psLate = await cmdPs(storageRoot);
    expect(psLate).toEqual(["(no running threads)"]);
  });

  test("kill stops thread after the in-flight role (before subsequent roles)", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, abortablePlannerBundleSource, "utf8");

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

    const threadId = ran.value.threadId;

    await new Promise((r) => setTimeout(r, 50));

    const killed = await cmdKill(storageRoot, threadId);
    expect(killed.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 900));

    const dataPath = join(storageRoot, "logs", added.value.hash, `${threadId}.data.jsonl`);
    const text = await readFile(dataPath, "utf8");
    const lines = text
      .trim()
      .split("\n")
      .filter((l) => l !== "");
    expect(lines.length).toBe(3);

    const runningPath = join(dirname(dataPath), `${threadId}.running`);
    expect(await pathExists(runningPath)).toBe(false);
  });

  test("pause stops between yields and resume completes thread", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, pauseResumeBundleSource, "utf8");

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

    const threadId = ran.value.threadId;
    const dataPath = join(storageRoot, "logs", added.value.hash, `${threadId}.data.jsonl`);

    await waitUntilMinDataLines(dataPath, 2, 80);
    expect(await countDataJsonlLines(dataPath)).toBe(2);

    const paused = await cmdPause(storageRoot, threadId);
    expect(paused.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 400));
    expect(await countDataJsonlLines(dataPath)).toBe(2);

    const resumed = await cmdResume(storageRoot, threadId);
    expect(resumed.ok).toBe(true);

    await waitUntilMinDataLines(dataPath, 4, 120);
    expect(await countDataJsonlLines(dataPath)).toBe(4);

    const runningPath = join(dirname(dataPath), `${threadId}.running`);
    await waitUntilRunningFileAbsent(runningPath, 100);
    expect(await pathExists(runningPath)).toBe(false);
  });

  test("pause on completed thread errors", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, fastBundleSource, "utf8");

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

    const threadId = ran.value.threadId;
    const dataPath = join(storageRoot, "logs", added.value.hash, `${threadId}.data.jsonl`);
    const runningPath = join(dirname(dataPath), `${threadId}.running`);

    await waitUntilRunningFileAbsent(runningPath, 100);
    expect(await pathExists(runningPath)).toBe(false);

    const paused = await cmdPause(storageRoot, threadId);
    expect(paused.ok).toBe(false);
  });

  test("resume while thread is running but not paused errors", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, delayedFirstYieldBundleSource, "utf8");

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

    const threadId = ran.value.threadId;
    await new Promise((r) => setTimeout(r, 40));

    const resumed = await cmdResume(storageRoot, threadId);
    expect(resumed.ok).toBe(false);
  });
});
