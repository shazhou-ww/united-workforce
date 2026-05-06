import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cmdAdd } from "../src/cmd-add.js";
import { cmdKill } from "../src/cmd-kill.js";
import { cmdPs } from "../src/cmd-ps.js";
import { cmdRun } from "../src/cmd-run.js";
import { cmdThreadRemove, cmdThreadShow } from "../src/cmd-thread.js";
import { cmdThreads } from "../src/cmd-threads.js";
import { pathExists } from "../src/fs-utils.js";

const fastBundleSource = `export default {
  name: "solve-issue",
  roles: {
    planner: async () => ({ content: "plan", meta: { plan: "x" } }),
    coder: async () => ({ content: "code", meta: { diff: "y" } }),
  },
  moderator(ctx) {
    if (ctx.steps.length === 0) return "planner";
    if (ctx.steps.length === 1) return "coder";
    return "__end__";
  },
};
`;

const slowPlannerBundleSource = `export default {
  name: "solve-issue",
  roles: {
    planner: async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { content: "plan", meta: { plan: "x" } };
    },
    coder: async () => ({ content: "code", meta: { diff: "y" } }),
  },
  moderator(ctx) {
    if (ctx.steps.length === 0) return "planner";
    if (ctx.steps.length === 1) return "coder";
    return "__end__";
  },
};
`;

const cliEntryPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const abortablePlannerBundleSource = `export default {
  name: "solve-issue",
  roles: {
    planner: async () => {
      await new Promise((r) => setTimeout(r, 600));
      return { content: "plan", meta: { plan: "x" } };
    },
    coder: async () => ({ content: "code", meta: { diff: "y" } }),
  },
  moderator(ctx) {
    if (ctx.steps.length === 0) return "planner";
    if (ctx.steps.length === 1) return "coder";
    return "__end__";
  },
};
`;

describe("cli thread commands", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-thread-"));
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

  test("run / threads / thread / thread rm", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, fastBundleSource, "utf8");

    const added = await cmdAdd(storageRoot, "solve-issue", bundlePath);
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }

    const ran = await cmdRun(storageRoot, "solve-issue", "hello", false, 5);
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

  test("cli entrypoint dispatches threads / ps (spawn)", () => {
    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: storageRoot };
    const threads = spawnSync(process.execPath, [cliEntryPath, "threads"], {
      env,
      encoding: "utf8",
    });
    expect(threads.status).toBe(0);

    const ps = spawnSync(process.execPath, [cliEntryPath, "ps"], { env, encoding: "utf8" });
    expect(ps.status).toBe(0);
  });

  test("ps lists running threads while planner role is in-flight", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(bundlePath, slowPlannerBundleSource, "utf8");

    const added = await cmdAdd(storageRoot, "solve-issue", bundlePath);
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }

    const ran = await cmdRun(storageRoot, "solve-issue", "hello", false, 5);
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

    const added = await cmdAdd(storageRoot, "solve-issue", bundlePath);
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }

    const ran = await cmdRun(storageRoot, "solve-issue", "hello", false, 5);
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
    expect(lines.length).toBe(2);

    const runningPath = join(dirname(dataPath), `${threadId}.running`);
    expect(await pathExists(runningPath)).toBe(false);
  });
});
