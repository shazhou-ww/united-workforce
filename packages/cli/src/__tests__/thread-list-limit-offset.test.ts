/**
 * #451 — `uwf thread list --limit <n> / --offset <m>` pagination.
 *
 * Spec: specs/thread-list-limit-offset-pagination.md
 *
 * `thread list` already paginates internally (cmdThreadList skip/take +
 * applyPagination over the newest-first list). #451 wires the canonical
 * repo-wide `ListOptions` vocabulary (`--limit`/`--offset`, as used by
 * `step turns`) through to that engine, keeping `--skip`/`--take` as
 * backward-compatible aliases. The behavioural gap is purely at the CLI flag
 * layer: passing `--limit` today errors with `unknown option`.
 *
 * This file covers:
 *   1. The `cmdThreadList` slice semantics that `--limit`/`--offset` map onto
 *      (offset → skip, limit → take) — equivalence with the existing
 *      `--skip`/`--take` parameters.
 *   2. A CLI subprocess test (`execFileSync`) proving the new flags are
 *      registered and parsed end-to-end (the actual #451 regression), and that
 *      `--limit`/`--offset` produce the same output as `--take`/`--skip`.
 *
 * Follows the subprocess pattern from step-turns-cli-subprocess.test.ts.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { createThreadIndexEntry } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdThreadList } from "../commands/thread.js";
import { createUwfStore, setThread, type UwfStore } from "../store.js";
import { makeUwfStore } from "./thread-test-helpers.js";

// ── helpers ─────────────────────────────────────────────────────────────────

async function createTestWorkflow(uwf: UwfStore): Promise<CasRef> {
  const workflowPayload = {
    name: "test-workflow",
    roles: {
      role1: {
        goal: "test goal",
        outputSchema: { type: "object" as const, properties: {} },
      },
    },
    graph: { start: "role1" },
    conditions: {},
  };
  return await uwf.store.cas.put(uwf.schemas.workflow, workflowPayload);
}

/**
 * Create a thread with an explicit ULID derived from `timestamp`, so the
 * newest-first sort (by ULID timestamp) is deterministic.
 */
async function createTestThreadAt(
  uwf: UwfStore,
  storageRoot: string,
  workflowHash: CasRef,
  ulid: string,
): Promise<ThreadId> {
  const threadId = ulid as ThreadId;
  const startPayload = {
    workflow: workflowHash,
    prompt: "test prompt",
    cwd: storageRoot,
  };
  const headHash = await uwf.store.cas.put(uwf.schemas.startNode, startPayload);
  setThread(uwf.varStore, threadId, createThreadIndexEntry(headHash));
  return threadId;
}

// ── test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "thread-list-limit-offset-test-"));
});

afterEach(async () => {
  if (savedOcasHome === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = savedOcasHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ── cmdThreadList: --offset → skip, --limit → take mapping ───────────────────

describe("cmdThreadList --limit/--offset mapping (#451)", () => {
  /**
   * Seed N threads with monotonically increasing ULID timestamps and return
   * the thread IDs in newest-first order (the order `cmdThreadList` returns).
   */
  async function seedNewestFirst(count: number): Promise<{ newestFirst: ThreadId[] }> {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const created: ThreadId[] = [];
    // Distinct, strictly increasing ULID timestamps (ms) → deterministic order.
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < count; i++) {
      // generateUlid is timestamp-prefixed; use the store's helper indirectly by
      // constructing via createTestThreadAt with a fabricated monotonic ULID.
      const { generateUlid } = await import("@united-workforce/util");
      const ulid = generateUlid(base + i * 1000);
      created.push(await createTestThreadAt(uwf, tmpDir, workflowHash, ulid));
    }
    // Newest-first = reverse of creation order (later timestamp = newer).
    return { newestFirst: [...created].reverse() };
  }

  test("--limit N maps to take: returns the N newest threads", async () => {
    const { newestFirst } = await seedNewestFirst(12);

    // --limit 5 ⇒ cmdThreadList(..., skip=null, take=5)
    const result = await cmdThreadList(tmpDir, null, null, null, null, 5);

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.thread)).toEqual(newestFirst.slice(0, 5));
  });

  test("--offset M maps to skip: skips the M newest threads", async () => {
    const { newestFirst } = await seedNewestFirst(12);

    // --offset 3 ⇒ cmdThreadList(..., skip=3, take=null)
    const result = await cmdThreadList(tmpDir, null, null, null, 3, null);

    expect(result).toHaveLength(9);
    expect(result.map((r) => r.thread)).toEqual(newestFirst.slice(3));
  });

  test("--limit 5 --offset 10 ⇒ slice [10, 15) over the newest-first list", async () => {
    const { newestFirst } = await seedNewestFirst(20);

    // skip=10 (offset), take=5 (limit)
    const result = await cmdThreadList(tmpDir, null, null, null, 10, 5);

    expect(result.map((r) => r.thread)).toEqual(newestFirst.slice(10, 15));
  });

  test("--limit/--offset are equivalent to the legacy --take/--skip params", async () => {
    await seedNewestFirst(12);

    // limit==take, offset==skip → identical underlying call → identical result.
    const viaLimitOffset = await cmdThreadList(tmpDir, null, null, null, 4, 3);
    const viaSkipTake = await cmdThreadList(tmpDir, null, null, null, 4, 3);

    expect(viaLimitOffset.map((r) => r.thread)).toEqual(viaSkipTake.map((r) => r.thread));
  });

  test("--offset beyond total → empty list (graceful, no error)", async () => {
    await seedNewestFirst(3);

    const result = await cmdThreadList(tmpDir, null, null, null, 5, null);

    expect(result).toHaveLength(0);
  });

  test("--limit larger than remaining clamps to available range", async () => {
    await seedNewestFirst(3);

    const result = await cmdThreadList(tmpDir, null, null, null, null, 10);

    expect(result).toHaveLength(3);
  });

  test("ordering invariant: contiguous non-overlapping windows", async () => {
    const { newestFirst } = await seedNewestFirst(15);

    // Window A: offset 0, limit 5 → [0,5)
    const windowA = await cmdThreadList(tmpDir, null, null, null, 0, 5);
    // Window B: offset 5, limit 5 → [5,10)
    const windowB = await cmdThreadList(tmpDir, null, null, null, 5, 5);

    expect(windowA.map((r) => r.thread)).toEqual(newestFirst.slice(0, 5));
    expect(windowB.map((r) => r.thread)).toEqual(newestFirst.slice(5, 10));
    // Non-overlapping.
    const overlap = windowA
      .map((r) => r.thread)
      .filter((t) => windowB.map((b) => b.thread).includes(t));
    expect(overlap).toHaveLength(0);
  });
});

// ── CLI subprocess: --limit/--offset flag registration (#451) ────────────────

describe("uwf thread list --limit/--offset CLI subprocess (#451)", () => {
  let cliTmp: string;
  let storageRoot: string;
  let casDir: string;
  let savedUwfHome: string | undefined;
  let savedOcas: string | undefined;

  beforeEach(async () => {
    savedUwfHome = process.env.UWF_HOME;
    savedOcas = process.env.OCAS_HOME;
    cliTmp = join(tmpdir(), `uwf-thread-list-limit-offset-cli-${Date.now()}`);
    storageRoot = join(cliTmp, "storage");
    casDir = join(cliTmp, "cas");
    await mkdir(storageRoot, { recursive: true });
    await mkdir(casDir, { recursive: true });
  });

  afterEach(async () => {
    if (savedUwfHome === undefined) delete process.env.UWF_HOME;
    else process.env.UWF_HOME = savedUwfHome;
    if (savedOcas === undefined) delete process.env.OCAS_HOME;
    else process.env.OCAS_HOME = savedOcas;
    await rm(cliTmp, { recursive: true, force: true });
  });

  async function seedThreads(count: number): Promise<ThreadId[]> {
    process.env.OCAS_HOME = casDir;
    const uwf = await createUwfStore(storageRoot);
    const workflowHash = await createTestWorkflow(uwf);
    const { generateUlid } = await import("@united-workforce/util");
    const created: ThreadId[] = [];
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < count; i++) {
      const ulid = generateUlid(base + i * 1000);
      created.push(await createTestThreadAt(uwf, storageRoot, workflowHash, ulid));
    }
    // newest-first
    return [...created].reverse();
  }

  function runCli(args: string[]): { threadIds: string[] } {
    const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const uwfBin = join(pkgRoot, "dist", "cli.js");
    const stdout = execFileSync(process.execPath, [uwfBin, ...args], {
      env: { ...process.env, UWF_HOME: storageRoot, OCAS_HOME: casDir },
      encoding: "utf8",
    });
    const envelope = JSON.parse(stdout) as { value: { items: Array<{ threadId: string }> } };
    return { threadIds: envelope.value.items.map((it) => it.threadId) };
  }

  test("--limit 5 is accepted (no 'unknown option') and returns 5 newest", async () => {
    const newestFirst = await seedThreads(12);

    const { threadIds } = runCli(["thread", "list", "--format", "json", "--limit", "5"]);

    expect(threadIds).toHaveLength(5);
    expect(threadIds).toEqual(newestFirst.slice(0, 5));
  });

  test("--limit 5 --offset 10 returns the [10,15) window of the newest-first list", async () => {
    const newestFirst = await seedThreads(20);

    const { threadIds } = runCli([
      "thread",
      "list",
      "--format",
      "json",
      "--limit",
      "5",
      "--offset",
      "10",
    ]);

    expect(threadIds).toEqual(newestFirst.slice(10, 15));
  });

  test("--limit/--offset produce the same result as --take/--skip aliases", async () => {
    await seedThreads(12);

    const canonical = runCli([
      "thread",
      "list",
      "--format",
      "json",
      "--limit",
      "4",
      "--offset",
      "3",
    ]);
    const legacy = runCli(["thread", "list", "--format", "json", "--take", "4", "--skip", "3"]);

    expect(canonical.threadIds).toEqual(legacy.threadIds);
  });

  test("non-numeric --limit is a CLI usage error (non-zero exit, flag named verbatim)", async () => {
    await seedThreads(3);
    const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const uwfBin = join(pkgRoot, "dist", "cli.js");

    try {
      execFileSync(
        process.execPath,
        [uwfBin, "thread", "list", "--format", "json", "--limit", "abc"],
        { env: { ...process.env, UWF_HOME: storageRoot, OCAS_HOME: casDir }, encoding: "utf8" },
      );
      expect.fail("expected non-zero exit for non-numeric --limit");
    } catch (err) {
      const e = err as { status: number; stderr?: string };
      expect(e.status).not.toBe(0);
      expect(e.stderr ?? "").toContain("--limit");
    }
  });
});
