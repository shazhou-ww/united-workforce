/**
 * #423 — CLI subprocess integration test for `uwf step turns`.
 *
 * This test exercises the full CLI invocation path via subprocess (`execFileSync`),
 * catching regressions that function-level tests cannot detect:
 *   - Argument parsing (yargs configuration)
 *   - Output formatting at the command boundary
 *   - Environment variable handling (UWF_HOME, OCAS_HOME)
 *   - Exit code behavior
 *
 * The test covers a RECURRING ROLE scenario (developer → reviewer → developer)
 * which was the root cause of #412 and is the most likely to regress.
 *
 * Existing function-level tests (step-turns.test.ts, step-turns-panorama-phase3.test.ts)
 * verify `cmdStepTurns` directly — this test does NOT duplicate those; it only
 * adds the missing subprocess/CLI-level coverage.
 *
 * Follows the pattern established in thread-start-cwd-cli.test.ts.
 */

import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { putSchema } from "@ocas/core";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createUwfStore,
  setActiveTurnHead,
  setThread,
  type UwfStore,
  writeStepStart,
  writeTurnNode,
} from "../store.js";

// ── test setup ───────────────────────────────────────────────────────────────

const THREAD_ID = "06FD9WEG5BH7C8JPD04X4184E4" as ThreadId;

const DETAIL_SCHEMA = {
  title: "broker-detail-cli-test",
  type: "object" as const,
  required: ["sessionId", "duration", "turnCount"],
  properties: {
    sessionId: { type: "string" as const },
    duration: { type: "integer" as const },
    turnCount: { type: "integer" as const },
  },
  additionalProperties: false,
};

let tmpDir: string;
let storageRoot: string;
let casDir: string;
let savedUwfHome: string | undefined;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedUwfHome = process.env.UWF_HOME;
  savedOcasHome = process.env.OCAS_HOME;

  tmpDir = join(tmpdir(), `uwf-step-turns-cli-${Date.now()}`);
  storageRoot = join(tmpDir, "storage");
  casDir = join(tmpDir, "cas");
  await mkdir(storageRoot, { recursive: true });
  await mkdir(casDir, { recursive: true });
});

afterEach(async () => {
  if (savedUwfHome === undefined) delete process.env.UWF_HOME;
  else process.env.UWF_HOME = savedUwfHome;
  if (savedOcasHome === undefined) delete process.env.OCAS_HOME;
  else process.env.OCAS_HOME = savedOcasHome;

  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Seed a thread with a recurring role pattern: developer → reviewer → developer.
 * This scenario exercises the #412 fix (owner-based segmentation) and ensures
 * the CLI correctly renders separate segments for the same role.
 *
 * Returns the thread ID for CLI invocation.
 */
async function seedRecurringRoleThread(uwf: UwfStore): Promise<ThreadId> {
  // Create workflow and start node
  const workflowHash = uwf.store.cas.put(uwf.schemas.workflow, {
    version: 1,
    name: "recurring-role-test",
    description: "test workflow for recurring role CLI test",
    roles: {},
    graph: {},
  }) as CasRef;
  const startHash = uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "implement feature X",
    cwd: "/tmp/test",
  }) as CasRef;

  const detailSchemaHash = putSchema(uwf.store, DETAIL_SCHEMA);
  const outputHash = uwf.store.cas.put(uwf.schemas.text, "output") as CasRef;

  // Step 1: developer round 1 — 2 turns
  const stepStart1 = writeStepStart(uwf, {
    role: "developer",
    edgePrompt: "Implement feature X",
    stepIndex: 0,
    prev: null,
    start: startHash,
    startedAtMs: 1000,
    cwd: "/tmp/test",
  });
  const t1 = writeTurnNode(uwf, {
    role: "assistant",
    content: "DEV_R1_TURN_1: Reading requirements...",
    prev: null,
    owner: stepStart1,
  });
  const t2 = writeTurnNode(uwf, {
    role: "assistant",
    content: "DEV_R1_TURN_2: Implementation complete.",
    prev: t1,
    owner: stepStart1,
  });
  const detail1 = uwf.store.cas.put(detailSchemaHash, {
    sessionId: "ses_dev_r1",
    duration: 5,
    turnCount: 2,
  }) as CasRef;
  const stepNode1 = uwf.store.cas.put(uwf.schemas.stepNode, {
    start: startHash,
    prev: null,
    role: "developer",
    output: outputHash,
    detail: detail1,
    agent: "test-agent",
    edgePrompt: "Implement feature X",
    startedAtMs: 1000,
    completedAtMs: 2000,
    cwd: "/tmp/test",
    assembledPrompt: null,
    usage: null,
    previousAttempts: null,
  }) as CasRef;

  // Step 2: reviewer — 2 turns
  const stepStart2 = writeStepStart(uwf, {
    role: "reviewer",
    edgePrompt: "Review the implementation",
    stepIndex: 1,
    prev: stepStart1,
    start: startHash,
    startedAtMs: 3000,
    cwd: "/tmp/test",
  });
  const t3 = writeTurnNode(uwf, {
    role: "assistant",
    content: "REV_TURN_1: Reviewing code quality...",
    prev: t2,
    owner: stepStart2,
  });
  const t4 = writeTurnNode(uwf, {
    role: "assistant",
    content: "REV_TURN_2: Found issues, requesting changes.",
    prev: t3,
    owner: stepStart2,
  });
  const detail2 = uwf.store.cas.put(detailSchemaHash, {
    sessionId: "ses_rev",
    duration: 4,
    turnCount: 2,
  }) as CasRef;
  const stepNode2 = uwf.store.cas.put(uwf.schemas.stepNode, {
    start: startHash,
    prev: stepNode1,
    role: "reviewer",
    output: outputHash,
    detail: detail2,
    agent: "test-agent",
    edgePrompt: "Review the implementation",
    startedAtMs: 3000,
    completedAtMs: 4000,
    cwd: "/tmp/test",
    assembledPrompt: null,
    usage: null,
    previousAttempts: null,
  }) as CasRef;

  // Step 3: developer round 2 — 3 turns
  const stepStart3 = writeStepStart(uwf, {
    role: "developer",
    edgePrompt: "Address reviewer feedback",
    stepIndex: 2,
    prev: stepStart2,
    start: startHash,
    startedAtMs: 5000,
    cwd: "/tmp/test",
  });
  const t5 = writeTurnNode(uwf, {
    role: "assistant",
    content: "DEV_R2_TURN_1: Reading feedback...",
    prev: t4,
    owner: stepStart3,
  });
  const t6 = writeTurnNode(uwf, {
    role: "assistant",
    content: "DEV_R2_TURN_2: Making requested changes...",
    prev: t5,
    owner: stepStart3,
  });
  const t7 = writeTurnNode(uwf, {
    role: "assistant",
    content: "DEV_R2_TURN_3: Changes complete, ready for re-review.",
    prev: t6,
    owner: stepStart3,
  });
  const detail3 = uwf.store.cas.put(detailSchemaHash, {
    sessionId: "ses_dev_r2",
    duration: 6,
    turnCount: 3,
  }) as CasRef;
  const stepNode3 = uwf.store.cas.put(uwf.schemas.stepNode, {
    start: startHash,
    prev: stepNode2,
    role: "developer",
    output: outputHash,
    detail: detail3,
    agent: "test-agent",
    edgePrompt: "Address reviewer feedback",
    startedAtMs: 5000,
    completedAtMs: 6000,
    cwd: "/tmp/test",
    assembledPrompt: null,
    usage: null,
    previousAttempts: null,
  }) as CasRef;

  // Set thread state — all steps completed
  setThread(uwf.varStore, THREAD_ID, {
    head: stepNode3,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });

  // Set active-turn-head to the last turn
  setActiveTurnHead(uwf.store, THREAD_ID, t7);

  return THREAD_ID;
}

// ── spec: step-turns-cli-subprocess-recurring-role.md ────────────────────────

describe("uwf step turns CLI subprocess integration (#423)", () => {
  test("recurring role scenario (developer→reviewer→developer) via subprocess", async () => {
    // Setup: seed the store with recurring role thread
    process.env.OCAS_HOME = casDir;
    const uwf = await createUwfStore(storageRoot);
    const threadId = await seedRecurringRoleThread(uwf);

    // Build paths to CLI binary
    const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const uwfBin = join(pkgRoot, "dist", "cli.js");

    // Invoke CLI via subprocess
    const output = execFileSync(process.execPath, [uwfBin, "step", "turns", threadId], {
      env: { ...process.env, UWF_HOME: storageRoot, OCAS_HOME: casDir },
      encoding: "utf8",
    });

    // Exit code 0 is implicit — execFileSync throws on non-zero exit

    // Verify: 3 step groups in chronological order
    const groups = output.match(/## (developer|reviewer)/g);
    expect(groups).toEqual(["## developer", "## reviewer", "## developer"]);

    // Verify: Both developer segments present (NOT collapsed)
    const firstDevIdx = output.indexOf("## developer");
    const reviewerIdx = output.indexOf("## reviewer");
    const secondDevIdx = output.indexOf("## developer", reviewerIdx + 1);
    expect(firstDevIdx).toBeLessThan(reviewerIdx);
    expect(reviewerIdx).toBeLessThan(secondDevIdx);

    // Verify: Each segment's turns are correctly attributed (no cross-segment leakage)
    const devR1Section = output.slice(firstDevIdx, reviewerIdx);
    const revSection = output.slice(reviewerIdx, secondDevIdx);
    const devR2Section = output.slice(secondDevIdx);

    // Developer round 1: 2 turns
    expect(devR1Section).toContain("DEV_R1_TURN_1");
    expect(devR1Section).toContain("DEV_R1_TURN_2");
    expect(devR1Section).not.toContain("REV_TURN");
    expect(devR1Section).not.toContain("DEV_R2_TURN");

    // Reviewer: 2 turns
    expect(revSection).toContain("REV_TURN_1");
    expect(revSection).toContain("REV_TURN_2");
    expect(revSection).not.toContain("DEV_R1_TURN");
    expect(revSection).not.toContain("DEV_R2_TURN");

    // Developer round 2: 3 turns
    expect(devR2Section).toContain("DEV_R2_TURN_1");
    expect(devR2Section).toContain("DEV_R2_TURN_2");
    expect(devR2Section).toContain("DEV_R2_TURN_3");
    expect(devR2Section).not.toContain("DEV_R1_TURN");
    expect(devR2Section).not.toContain("REV_TURN");

    // Verify: All 7 turns rendered with global numbering (Turn 1 through Turn 7)
    expect(output).toContain("## Turn 1");
    expect(output).toContain("## Turn 2");
    expect(output).toContain("## Turn 3");
    expect(output).toContain("## Turn 4");
    expect(output).toContain("## Turn 5");
    expect(output).toContain("## Turn 6");
    expect(output).toContain("## Turn 7");

    // Verify: All steps marked as completed (✓)
    const checkmarks = output.match(/✓/g);
    expect(checkmarks).toHaveLength(3);
  });

  test("CLI accepts --role filter via subprocess", async () => {
    // Setup
    process.env.OCAS_HOME = casDir;
    const uwf = await createUwfStore(storageRoot);
    const threadId = await seedRecurringRoleThread(uwf);

    const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const uwfBin = join(pkgRoot, "dist", "cli.js");

    // Invoke CLI with --role developer
    const output = execFileSync(
      process.execPath,
      [uwfBin, "step", "turns", threadId, "--role", "developer"],
      {
        env: { ...process.env, UWF_HOME: storageRoot, OCAS_HOME: casDir },
        encoding: "utf8",
      },
    );

    // Verify: Only developer groups present
    const groups = output.match(/## (developer|reviewer)/g);
    expect(groups).toEqual(["## developer", "## developer"]);

    // Verify: No reviewer turns
    expect(output).not.toContain("REV_TURN");

    // Verify: Both developer segment turns present
    expect(output).toContain("DEV_R1_TURN");
    expect(output).toContain("DEV_R2_TURN");
  });

  test("CLI accepts --limit and --offset pagination via subprocess", async () => {
    // Setup
    process.env.OCAS_HOME = casDir;
    const uwf = await createUwfStore(storageRoot);
    const threadId = await seedRecurringRoleThread(uwf);

    const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const uwfBin = join(pkgRoot, "dist", "cli.js");

    // Invoke CLI with --offset 2 --limit 3 (turns 3, 4, 5)
    const output = execFileSync(
      process.execPath,
      [uwfBin, "step", "turns", threadId, "--offset", "2", "--limit", "3"],
      {
        env: { ...process.env, UWF_HOME: storageRoot, OCAS_HOME: casDir },
        encoding: "utf8",
      },
    );

    // Verify: Global indices Turn 3, Turn 4, Turn 5 (1-based display)
    expect(output).toContain("## Turn 3");
    expect(output).toContain("## Turn 4");
    expect(output).toContain("## Turn 5");

    // Verify: Turns 1, 2 are skipped
    expect(output).not.toContain("## Turn 1");
    expect(output).not.toContain("## Turn 2");

    // Verify: Turns 6, 7 are beyond the limit
    expect(output).not.toContain("## Turn 6");
    expect(output).not.toContain("## Turn 7");
  });

  test("CLI exits with error for invalid thread ID", async () => {
    const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const uwfBin = join(pkgRoot, "dist", "cli.js");

    // Invoke CLI with a non-existent thread ID
    const invalidThreadId = "06FDINVALIDTHREADID000000";

    try {
      execFileSync(process.execPath, [uwfBin, "step", "turns", invalidThreadId], {
        env: { ...process.env, UWF_HOME: storageRoot, OCAS_HOME: casDir },
        encoding: "utf8",
      });
      // If we get here, the command didn't fail as expected
      expect.fail("Expected CLI to exit with non-zero code for invalid thread ID");
    } catch (err) {
      // execFileSync throws on non-zero exit — this is expected
      const error = err as { status: number; stderr?: Buffer };
      expect(error.status).not.toBe(0);
    }
  });
});
