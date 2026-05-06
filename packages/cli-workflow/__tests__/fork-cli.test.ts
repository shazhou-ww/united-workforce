import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdAdd } from "../src/cmd-add.js";
import { cmdFork } from "../src/cmd-fork.js";
import { cmdRun } from "../src/cmd-run.js";
import { pathExists } from "../src/fs-utils.js";
import { addCliArgs } from "./bundle-fixture.js";

/** Three-role workflow that respects `input.steps` for fork/resume. */
const threeRoleBundleSource = `export const descriptor = {
  description: "fork-cli",
  roles: {
    planner: { description: "planner", schema: {} },
    coder: { description: "coder", schema: {} },
    reviewer: { description: "reviewer", schema: {} },
  },
};
export const run = async function* (input) {
  const has = (r) => input.steps.some((s) => s.role === r);
  if (!has("planner")) {
    yield { role: "planner", content: "p1", meta: { k: "planner" } };
  }
  if (!has("coder")) {
    yield { role: "coder", content: "c1", meta: { k: "coder" } };
  }
  if (!has("reviewer")) {
    yield {
      role: "reviewer",
      content: "rev-" + String(input.steps.length),
      meta: { k: "reviewer" },
    };
  }
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

async function waitUntilMinDataLines(dataPath: string, minLines: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await countDataJsonlLines(dataPath)) >= minLines) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitUntilRunningAbsent(runningPath: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!(await pathExists(runningPath))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("cli fork", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-fork-"));
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
    const sourceData = join(storageRoot, "logs", hash, `${sourceId}.data.jsonl`);
    const sourceRunning = join(storageRoot, "logs", hash, `${sourceId}.running`);
    await waitUntilRunningAbsent(sourceRunning);
    await waitUntilMinDataLines(sourceData, 4);

    const forked = await cmdFork(storageRoot, sourceId, "planner");
    expect(forked.ok).toBe(true);
    if (!forked.ok) {
      return;
    }
    const newId = forked.value.threadId;
    const newData = join(storageRoot, "logs", hash, `${newId}.data.jsonl`);
    const newRunning = join(storageRoot, "logs", hash, `${newId}.running`);
    await waitUntilRunningAbsent(newRunning);
    await waitUntilMinDataLines(newData, 4);

    const text = await readFile(newData, "utf8");
    const lines = text
      .trim()
      .split("\n")
      .filter((l) => l !== "");
    expect(lines.length).toBe(4);
    const start = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(start.threadId).toBe(newId);
    expect(start.forkFrom).toEqual({ threadId: sourceId });

    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
    expect(last.role).toBe("reviewer");
    expect(last.content).toBe("rev-1");
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
    const sourceData = join(storageRoot, "logs", hash, `${sourceId}.data.jsonl`);
    const sourceRunning = join(storageRoot, "logs", hash, `${sourceId}.running`);
    await waitUntilRunningAbsent(sourceRunning);
    await waitUntilMinDataLines(sourceData, 4);

    const forked = await cmdFork(storageRoot, sourceId, null);
    expect(forked.ok).toBe(true);
    if (!forked.ok) {
      return;
    }
    const newId = forked.value.threadId;
    const newData = join(storageRoot, "logs", hash, `${newId}.data.jsonl`);
    const newRunning = join(storageRoot, "logs", hash, `${newId}.running`);
    await waitUntilRunningAbsent(newRunning);
    await waitUntilMinDataLines(newData, 4);

    const text = await readFile(newData, "utf8");
    const lines = text
      .trim()
      .split("\n")
      .filter((l) => l !== "");
    expect(lines.length).toBe(4);

    const replayCoder = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
    expect(replayCoder.role).toBe("coder");
    expect(replayCoder.content).toBe("c1");

    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
    expect(last.role).toBe("reviewer");
    expect(last.content).toBe("rev-2");
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
    const sourceData = join(storageRoot, "logs", added.value.hash, `${sourceId}.data.jsonl`);
    const sourceRunning = join(storageRoot, "logs", added.value.hash, `${sourceId}.running`);
    await waitUntilRunningAbsent(sourceRunning);
    await waitUntilMinDataLines(sourceData, 4);

    const bad = await cmdFork(storageRoot, sourceId, "ghost-role");
    expect(bad.ok).toBe(false);
    if (bad.ok) {
      return;
    }
    expect(bad.error).toContain("ghost-role");
    expect(bad.error).toContain("planner");
  });
});
