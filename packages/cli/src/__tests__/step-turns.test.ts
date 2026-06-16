/**
 * Phase 4 (#400) — `uwf step turns <thread-id> [--role <r>] [--live]`.
 *
 * The consumer side of the realtime-turns RFC. Covers the issue's testing
 * checklist via the three behavioral specs:
 *   - step-turns-read-order-active-then-detail.md  (Step 1)
 *   - step-turns-role-selection.md
 *   - step-turns-live-poll-active-var.md           (Step 2)
 *
 * `cmdStepTurns` resolves the turn list with active-var-first / detail.turns
 * fallback and renders it through the SAME per-turn pipeline as `step read`
 * (loadTurnData → formatTurnBody). `--live` polls the SQLite-backed active var
 * and prints each new turn exactly once, exiting when the step completes
 * (active var deleted and/or thread no longer running).
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema, type Store } from "@ocas/core";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdStepTurns } from "../commands/step.js";
import {
  appendActiveTurn,
  clearActiveTurns,
  createUwfStore,
  setThread,
  type UwfStore,
} from "../store.js";

// ── schemas (mirror the broker producer's TURN_SCHEMA + DETAIL_SCHEMA) ───────

const TURN_SCHEMA = {
  title: "broker-turn",
  type: "object" as const,
  required: ["role", "content"],
  properties: {
    role: { type: "string" as const, enum: ["assistant", "tool"] },
    content: { type: "string" as const },
  },
  additionalProperties: false,
};

const DETAIL_SCHEMA = {
  title: "broker-detail",
  type: "object" as const,
  required: ["sessionId", "duration", "turnCount", "turns"],
  properties: {
    sessionId: { type: "string" as const },
    duration: { type: "integer" as const },
    turnCount: { type: "integer" as const },
    turns: {
      type: "array" as const,
      items: { type: "string" as const, format: "ocas_ref" },
    },
  },
  additionalProperties: false,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function putTurn(store: Store, content: string): CasRef {
  const schemaHash = putSchema(store, TURN_SCHEMA);
  return store.cas.put(schemaHash, { role: "assistant", content }) as CasRef;
}

/** Seed a completed step chain whose head detail.turns === the given hashes. */
async function seedCompletedStep(
  uwf: UwfStore,
  threadId: ThreadId,
  role: string,
  turnHashes: CasRef[],
): Promise<void> {
  const workflowHash = (await uwf.store.cas.put(uwf.schemas.workflow, {
    version: 1,
    name: "turns-wf",
    description: "phase4",
    roles: {},
    graph: {},
  })) as CasRef;
  const startHash = (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "task",
    cwd: "/tmp/work",
  })) as CasRef;
  const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);
  const detailHash = (await uwf.store.cas.put(detailSchemaHash, {
    sessionId: "ses_x",
    duration: 5,
    turnCount: turnHashes.length,
    turns: turnHashes,
  })) as CasRef;
  const outputHash = (await uwf.store.cas.put(uwf.schemas.text, "output")) as CasRef;
  const stepHash = (await uwf.store.cas.put(uwf.schemas.stepNode, {
    start: startHash,
    prev: null,
    role,
    output: outputHash,
    detail: detailHash,
    agent: "uwf-test",
    edgePrompt: "",
    startedAtMs: 1000,
    completedAtMs: 6000,
  })) as CasRef;
  setThread(uwf.varStore, threadId, {
    head: stepHash,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });
}

/**
 * Seed a *completed multi-role* chain `planner → coder` whose head is the coder
 * step. Each step carries its own immutable `detail.turns`; the thread head var
 * points at the coder step (role `"coder"`), and the prior planner step (role
 * `"planner"`) is reachable only via `prev`. No active var remains (both roles
 * solidified + deleted). This is the `06FCZ...` fixture from
 * `step-turns-role-selection.md` — used to pin the role-aware detail fallback.
 */
async function seedCompletedTwoRoleChain(
  uwf: UwfStore,
  threadId: ThreadId,
  plannerTurns: CasRef[],
  coderTurns: CasRef[],
): Promise<void> {
  const workflowHash = (await uwf.store.cas.put(uwf.schemas.workflow, {
    version: 1,
    name: "turns-wf",
    description: "phase4",
    roles: {},
    graph: {},
  })) as CasRef;
  const startHash = (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "task",
    cwd: "/tmp/work",
  })) as CasRef;
  const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);
  const outputHash = (await uwf.store.cas.put(uwf.schemas.text, "output")) as CasRef;

  const mkStep = async (role: string, turns: CasRef[], prev: CasRef | null): Promise<CasRef> => {
    const detailHash = (await uwf.store.cas.put(detailSchemaHash, {
      sessionId: `ses_${role}`,
      duration: 5,
      turnCount: turns.length,
      turns,
    })) as CasRef;
    return (await uwf.store.cas.put(uwf.schemas.stepNode, {
      start: startHash,
      prev,
      role,
      output: outputHash,
      detail: detailHash,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: 1000,
      completedAtMs: 6000,
    })) as CasRef;
  };

  const plannerStep = await mkStep("planner", plannerTurns, null);
  const coderStep = await mkStep("coder", coderTurns, plannerStep);
  setThread(uwf.varStore, threadId, {
    head: coderStep,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });
}

/** Seed a thread whose head is only a StartNode (no steps yet). */
async function seedStartOnly(uwf: UwfStore, threadId: ThreadId): Promise<void> {
  const workflowHash = (await uwf.store.cas.put(uwf.schemas.workflow, {
    version: 1,
    name: "turns-wf",
    description: "phase4",
    roles: {},
    graph: {},
  })) as CasRef;
  const startHash = (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "task",
    cwd: "/tmp/work",
  })) as CasRef;
  setThread(uwf.varStore, threadId, {
    head: startHash,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });
}

// ── fixture ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "step-turns-"));
  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_HOME = casDir;
});

afterEach(async () => {
  if (savedOcasHome === undefined) delete process.env.OCAS_HOME;
  else process.env.OCAS_HOME = savedOcasHome;
  await rm(tmpDir, { recursive: true, force: true });
});

const THREAD_ID = "06FCYTURNSPHASE4CONSUMER1" as ThreadId;

// ── Step 1: read order — active var first, detail.turns fallback ─────────────

describe("cmdStepTurns read order (active var → detail.turns)", () => {
  test("running case: renders all turns from the active var", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);
    const t1 = putTurn(uwf.store, "t1");
    const t2 = putTurn(uwf.store, "t2");
    const t3 = putTurn(uwf.store, "t3");
    for (const h of [t1, t2, t3]) {
      appendActiveTurn(uwf.store, THREAD_ID, "coder", h);
    }

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    expect(out).toContain("## Turn 1");
    expect(out).toContain("## Turn 2");
    expect(out).toContain("## Turn 3");
    expect(out).toContain("**Turn role:** assistant");
    // Arrival order preserved.
    expect(out.indexOf("t1")).toBeLessThan(out.indexOf("t2"));
    expect(out.indexOf("t2")).toBeLessThan(out.indexOf("t3"));
  });

  test("completed case: renders the same turn blocks from detail.turns", async () => {
    const uwf = await createUwfStore(tmpDir);
    const t1 = putTurn(uwf.store, "t1");
    const t2 = putTurn(uwf.store, "t2");
    const t3 = putTurn(uwf.store, "t3");

    // (a) running snapshot from the active var.
    await seedStartOnly(uwf, THREAD_ID);
    for (const h of [t1, t2, t3]) appendActiveTurn(uwf.store, THREAD_ID, "coder", h);
    const running = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    // (b) completed: var gone, the same hashes solidified into detail.turns.
    clearActiveTurns(uwf.store, THREAD_ID, "coder");
    await seedCompletedStep(uwf, THREAD_ID, "coder", [t1, t2, t3]);
    const completed = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    // The per-turn blocks are byte-identical (header line may differ).
    const turnBlocks = (md: string) => md.slice(md.indexOf("## Turn 1"));
    expect(turnBlocks(completed)).toBe(turnBlocks(running));
    expect(completed).toContain("t1");
    expect(completed).toContain("t3");
  });

  test("active var takes precedence over a present detail.turns", async () => {
    const uwf = await createUwfStore(tmpDir);
    // Completed step holds OLD turns…
    const old1 = putTurn(uwf.store, "OLD-DETAIL");
    await seedCompletedStep(uwf, THREAD_ID, "coder", [old1]);
    // …but a fresh active var holds NEW turns: the var wins.
    const n1 = putTurn(uwf.store, "NEW-ACTIVE");
    appendActiveTurn(uwf.store, THREAD_ID, "coder", n1);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    expect(out).toContain("NEW-ACTIVE");
    expect(out).not.toContain("OLD-DETAIL");
  });

  test("empty: no active var and head is a StartNode → header only, no turn blocks", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    expect(out).not.toContain("## Turn");
    expect(out).toContain("coder");
  });

  test("empty: completed step with detail.turns === [] → header only", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedCompletedStep(uwf, THREAD_ID, "coder", []);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    expect(out).not.toContain("## Turn");
  });
});

// ── --role selection ─────────────────────────────────────────────────────────

describe("cmdStepTurns --role selection", () => {
  test("two concurrent role vars are addressed independently", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);
    const c1 = putTurn(uwf.store, "c1");
    const c2 = putTurn(uwf.store, "c2");
    const p1 = putTurn(uwf.store, "p1");
    appendActiveTurn(uwf.store, THREAD_ID, "coder", c1);
    appendActiveTurn(uwf.store, THREAD_ID, "coder", c2);
    appendActiveTurn(uwf.store, THREAD_ID, "planner", p1);

    const coder = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });
    expect(coder).toContain("c1");
    expect(coder).toContain("c2");
    expect(coder).not.toContain("p1");
    expect(coder).toContain("## Turn 2");
    expect(coder).not.toContain("## Turn 3");

    const planner = await cmdStepTurns(tmpDir, THREAD_ID, { role: "planner", live: false });
    expect(planner).toContain("p1");
    expect(planner).not.toContain("c1");
    expect(planner).not.toContain("c2");
  });

  test("role with no active var and no matching detail → empty, exit 0 (no crash)", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);
    appendActiveTurn(uwf.store, THREAD_ID, "coder", putTurn(uwf.store, "c1"));

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "reviewer", live: false });
    expect(out).not.toContain("## Turn");
  });

  test("role match is exact: 'coder' does not match a 'coder-2' var", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);
    appendActiveTurn(uwf.store, THREAD_ID, "coder-2", putTurn(uwf.store, "other-role"));

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });
    expect(out).not.toContain("other-role");
    expect(out).not.toContain("## Turn");
  });
});

// ── role-aware detail fallback on a completed multi-role thread ───────────────
// Regression for review blocking issue #1/#2 (#400): the completed-step fallback
// `readHeadDetailTurns` reads the thread head StepNode's `detail.turns` WITHOUT
// comparing the head step's role to the queried role. On a multi-role thread
// (`planner → coder`, head = coder step) this leaked the coder head step's turns
// for ANY `--role`. The prior suite only seeded single-role threads (head role ==
// queried role) or a StartNode head, so this case was untested. The fallback must
// be role-aware: use the head's `detail.turns` only when `headStepNode.role ===
// role`, else `[]`.

const MULTIROLE_THREAD_ID = "06FCZTURNSPHASE4MULTIROLE1" as ThreadId;

describe("cmdStepTurns detail fallback is role-aware (multi-role completed thread)", () => {
  test("--role coder (head IS the coder step) renders the head step's turns", async () => {
    const uwf = await createUwfStore(tmpDir);
    const p1 = putTurn(uwf.store, "p1");
    const c1 = putTurn(uwf.store, "c1");
    const c2 = putTurn(uwf.store, "c2");
    await seedCompletedTwoRoleChain(uwf, MULTIROLE_THREAD_ID, [p1], [c1, c2]);

    const coder = await cmdStepTurns(tmpDir, MULTIROLE_THREAD_ID, {
      role: "coder",
      live: false,
    });
    expect(coder).toContain("## Turn 1");
    expect(coder).toContain("## Turn 2");
    expect(coder).not.toContain("## Turn 3");
    expect(coder).toContain("c1");
    expect(coder).toContain("c2");
    expect(coder.indexOf("c1")).toBeLessThan(coder.indexOf("c2"));
  });

  test("--role planner (head is the coder step) renders EMPTY, not the coder head turns", async () => {
    const uwf = await createUwfStore(tmpDir);
    const p1 = putTurn(uwf.store, "p1");
    const c1 = putTurn(uwf.store, "c1");
    const c2 = putTurn(uwf.store, "c2");
    await seedCompletedTwoRoleChain(uwf, MULTIROLE_THREAD_ID, [p1], [c1, c2]);

    const planner = await cmdStepTurns(tmpDir, MULTIROLE_THREAD_ID, {
      role: "planner",
      live: false,
    });
    // The head StepNode is the coder step → its detail.turns MUST NOT surface
    // under --role planner. The fallback returns [] on role mismatch.
    expect(planner).not.toContain("## Turn");
    expect(planner).not.toContain("c1");
    expect(planner).not.toContain("c2");
    expect(planner).toContain("planner"); // header line only
  });

  test("--role reviewer (never ran on this thread) renders EMPTY, not the coder head turns", async () => {
    const uwf = await createUwfStore(tmpDir);
    const p1 = putTurn(uwf.store, "p1");
    const c1 = putTurn(uwf.store, "c1");
    const c2 = putTurn(uwf.store, "c2");
    await seedCompletedTwoRoleChain(uwf, MULTIROLE_THREAD_ID, [p1], [c1, c2]);

    const reviewer = await cmdStepTurns(tmpDir, MULTIROLE_THREAD_ID, {
      role: "reviewer",
      live: false,
    });
    expect(reviewer).not.toContain("## Turn");
    expect(reviewer).not.toContain("c1");
    expect(reviewer).not.toContain("c2");
  });
});

// ── --live incremental polling ───────────────────────────────────────────────

describe("cmdStepTurns --live poll", () => {
  test("prints each new turn exactly once and exits when the active var clears", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);

    const printed: string[] = [];
    let tick = 0;
    const t1 = putTurn(uwf.store, "L1");
    const t2 = putTurn(uwf.store, "L2");
    const t3 = putTurn(uwf.store, "L3");

    // The injected clock drives the producer: turns appear over ticks, then the
    // var is solidified+cleared, which is the stop signal.
    await cmdStepTurns(tmpDir, THREAD_ID, {
      role: "coder",
      live: true,
      pollIntervalMs: 0,
      onChunk: (chunk: string) => printed.push(chunk),
      // Simulate a running step until the producer clears the var (tick >= 4).
      isRunning: async () => tick < 4,
      sleep: async () => {
        tick += 1;
        if (tick === 1) appendActiveTurn(uwf.store, THREAD_ID, "coder", t1);
        else if (tick === 2) appendActiveTurn(uwf.store, THREAD_ID, "coder", t2);
        else if (tick === 3) appendActiveTurn(uwf.store, THREAD_ID, "coder", t3);
        else if (tick >= 4) clearActiveTurns(uwf.store, THREAD_ID, "coder");
      },
    });

    const joined = printed.join("\n");
    // Each turn content printed exactly once.
    expect(joined.match(/L1/g) ?? []).toHaveLength(1);
    expect(joined.match(/L2/g) ?? []).toHaveLength(1);
    expect(joined.match(/L3/g) ?? []).toHaveLength(1);
    // In arrival order.
    expect(joined.indexOf("L1")).toBeLessThan(joined.indexOf("L2"));
    expect(joined.indexOf("L2")).toBeLessThan(joined.indexOf("L3"));
    // Reused renderer.
    expect(joined).toContain("**Turn role:** assistant");
  });

  test("starting --live after completion degrades to printing detail.turns once", async () => {
    const uwf = await createUwfStore(tmpDir);
    const t1 = putTurn(uwf.store, "D1");
    const t2 = putTurn(uwf.store, "D2");
    await seedCompletedStep(uwf, THREAD_ID, "coder", [t1, t2]);

    const printed: string[] = [];
    await cmdStepTurns(tmpDir, THREAD_ID, {
      role: "coder",
      live: true,
      pollIntervalMs: 0,
      onChunk: (chunk: string) => printed.push(chunk),
      isRunning: async () => false,
      sleep: async () => {},
    });

    const joined = printed.join("\n");
    expect(joined).toContain("D1");
    expect(joined).toContain("D2");
    expect(joined.match(/D1/g) ?? []).toHaveLength(1);
  });

  test("multi-step run: exit reconcile is role-aware — never emits a different head role's turns", async () => {
    // Regression for review blocking issue #2 (#400). In a multi-step run
    // (`exec --count N≥2`) the running marker is held for the whole loop, so the
    // thread stays "running" while the head advances through roles
    // (coder → reviewer). A `--live --role coder` follower streams the coder
    // turns from the coder active var; by the time it exits, the head StepNode is
    // the *reviewer* step. The exit reconcile flush of the head's `detail.turns`
    // MUST be role-aware (head used only when its role === "coder"), else the
    // follower续吐 the reviewer step's turns as continued "coder" turns.
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);

    const c1 = putTurn(uwf.store, "LC1");
    const c2 = putTurn(uwf.store, "LC2");
    const r1 = putTurn(uwf.store, "LR1");
    const r2 = putTurn(uwf.store, "LR2");
    const r3 = putTurn(uwf.store, "LR3");

    const printed: string[] = [];
    let tick = 0;
    await cmdStepTurns(tmpDir, THREAD_ID, {
      role: "coder",
      live: true,
      pollIntervalMs: 0,
      onChunk: (chunk: string) => printed.push(chunk),
      // Thread is "running" for the whole multi-step loop until tick >= 3.
      isRunning: async () => tick < 3,
      sleep: async () => {
        tick += 1;
        if (tick === 1) appendActiveTurn(uwf.store, THREAD_ID, "coder", c1);
        else if (tick === 2) appendActiveTurn(uwf.store, THREAD_ID, "coder", c2);
        else if (tick === 3) {
          // coder step ends: its active var is solidified+deleted and the head
          // advances to the (completed) reviewer step — but the thread is still
          // "running" for the rest of the loop. Reviewer produced MORE turns (3)
          // than the coder follower printed (2): a count-blind reconcile flush
          // of the reviewer head's detail.turns would leak its tail (LR3) as a
          // continued coder turn. The role-aware fallback returns [] instead.
          clearActiveTurns(uwf.store, THREAD_ID, "coder");
          await seedCompletedStep(uwf, THREAD_ID, "reviewer", [r1, r2, r3]);
        }
      },
    });

    const joined = printed.join("\n");
    // The coder turns were streamed live, exactly once each.
    expect(joined.match(/LC1/g) ?? []).toHaveLength(1);
    expect(joined.match(/LC2/g) ?? []).toHaveLength(1);
    // The reviewer head step's turns MUST NOT be flushed under the coder follower
    // (the count-blind leak would surface the reviewer tail LR3 as coder Turn 3).
    expect(joined).not.toContain("LR1");
    expect(joined).not.toContain("LR2");
    expect(joined).not.toContain("LR3");
    expect(joined).not.toContain("## Turn 3");
  });
});
