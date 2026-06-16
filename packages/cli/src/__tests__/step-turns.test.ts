/**
 * #409 — `uwf step turns <thread-id>` is the whole-thread turn panorama.
 *
 * It walks the entire thread chain (reusing `walkChain` + `collectOrderedSteps`,
 * the same infra `cmdStepList` uses) and renders every step's turns in order —
 * each completed step from its own immutable `detail.turns` (marked `✓`), the
 * in-flight step from its `@uwf/active-turns/<tid>/<role>` var (marked
 * `🔄 进行中`). `--role` filters the panorama to one role's steps across the
 * whole chain; `--limit`/`--offset` paginate the flattened cross-step turn
 * sequence (filter first, then paginate). Default is full + untruncated.
 *
 * Covers the issue's testing checklist via the six specs:
 *   - step-turns-chain-panorama.md
 *   - step-turns-role-selection.md            (the #409 regression)
 *   - step-turns-read-order-active-then-detail.md
 *   - step-turns-pagination.md
 *   - step-turns-live-poll-active-var.md
 *
 * Per-turn blocks reuse the SAME pipeline as `step read`
 * (loadTurnData → formatTurnBody), so a turn block here is byte-identical to the
 * same turn under `uwf step read`.
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

async function putWorkflowAndStart(uwf: UwfStore): Promise<CasRef> {
  const workflowHash = (await uwf.store.cas.put(uwf.schemas.workflow, {
    version: 1,
    name: "turns-wf",
    description: "phase4",
    roles: {},
    graph: {},
  })) as CasRef;
  return (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "task",
    cwd: "/tmp/work",
  })) as CasRef;
}

/** Seed a completed step chain whose head detail.turns === the given hashes. */
async function seedCompletedStep(
  uwf: UwfStore,
  threadId: ThreadId,
  role: string,
  turnHashes: CasRef[],
): Promise<void> {
  const startHash = await putWorkflowAndStart(uwf);
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
 * Seed a linear completed chain of `steps` (oldest → newest), each carrying its
 * own immutable `detail.turns`. The thread head points at the last step; earlier
 * steps are reachable only via `prev`. Returns the per-step CAS hashes in order.
 * A step with `detail: null` is requested by passing `turns: null`.
 */
async function seedLinearChain(
  uwf: UwfStore,
  threadId: ThreadId,
  steps: { role: string; turns: CasRef[] | null }[],
): Promise<CasRef[]> {
  const startHash = await putWorkflowAndStart(uwf);
  const detailSchemaHash = await putSchema(uwf.store, DETAIL_SCHEMA);
  const outputHash = (await uwf.store.cas.put(uwf.schemas.text, "output")) as CasRef;
  const hashes: CasRef[] = [];
  let prev: CasRef | null = null;
  let i = 0;
  for (const step of steps) {
    let detail: CasRef | null = null;
    if (step.turns !== null) {
      detail = (await uwf.store.cas.put(detailSchemaHash, {
        sessionId: `ses_${step.role}_${i}`,
        duration: 5,
        turnCount: step.turns.length,
        turns: step.turns,
      })) as CasRef;
    }
    const stepHash = (await uwf.store.cas.put(uwf.schemas.stepNode, {
      start: startHash,
      prev,
      role: step.role,
      output: outputHash,
      detail,
      agent: "uwf-test",
      edgePrompt: "",
      startedAtMs: 1000 + i,
      completedAtMs: 6000 + i,
    })) as CasRef;
    hashes.push(stepHash);
    prev = stepHash;
    i += 1;
  }
  setThread(uwf.varStore, threadId, {
    head: prev ?? startHash,
    status: "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });
  return hashes;
}

/** Seed a thread whose head is only a StartNode (no steps yet). */
async function seedStartOnly(uwf: UwfStore, threadId: ThreadId): Promise<void> {
  const startHash = await putWorkflowAndStart(uwf);
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

/** The per-turn block region (## Turn 1 onward) — header/markers stripped. */
function turnBlocks(md: string): string {
  const i = md.indexOf("## Turn ");
  return i === -1 ? "" : md.slice(i);
}

// ── chain panorama: walk the whole chain, every step's turns ─────────────────

describe("cmdStepTurns chain panorama (#409)", () => {
  test("walks the whole chain: every step group appears, attributed to its role", async () => {
    const uwf = await createUwfStore(tmpDir);
    const p = [putTurn(uwf.store, "p-turn")];
    const d = [putTurn(uwf.store, "d-turn")];
    const r = [putTurn(uwf.store, "r-turn")];
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: p },
      { role: "developer", turns: d },
      { role: "reviewer", turns: r },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    // All three step groups present, in chronological order.
    expect(out).toContain("## planner");
    expect(out).toContain("## developer");
    expect(out).toContain("## reviewer");
    expect(out.indexOf("## planner")).toBeLessThan(out.indexOf("## developer"));
    expect(out.indexOf("## developer")).toBeLessThan(out.indexOf("## reviewer"));
    // Each step shows its OWN turns (per-step sourcing).
    expect(out.indexOf("p-turn")).toBeLessThan(out.indexOf("d-turn"));
    expect(out.indexOf("d-turn")).toBeLessThan(out.indexOf("r-turn"));
  });

  test("completed steps are marked ✓ with their turn count", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "p1"), putTurn(uwf.store, "p2")] },
      { role: "developer", turns: [putTurn(uwf.store, "d1")] },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    expect(out).toContain("## planner ✓ (2 turns)");
    expect(out).toContain("## developer ✓ (1 turns)");
    expect(out).not.toContain("进行中");
  });

  test("the in-flight step (active var, no settled StepNode) is marked 🔄 进行中", async () => {
    const uwf = await createUwfStore(tmpDir);
    // planner + developer settled; reviewer in flight via active var only.
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "p1")] },
      { role: "developer", turns: [putTurn(uwf.store, "d1")] },
    ]);
    appendActiveTurn(uwf.store, THREAD_ID, "reviewer", putTurn(uwf.store, "r-live-1"));
    appendActiveTurn(uwf.store, THREAD_ID, "reviewer", putTurn(uwf.store, "r-live-2"));

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    expect(out).toContain("## planner ✓ (1 turns)");
    expect(out).toContain("## developer ✓ (1 turns)");
    expect(out).toContain("## reviewer 🔄 进行中 (2 turns so far)");
    // The in-flight step appears after the completed steps.
    expect(out.indexOf("## developer")).toBeLessThan(out.indexOf("## reviewer"));
    expect(out).toContain("r-live-1");
    expect(out).toContain("r-live-2");
  });

  test("default shows all turns: no quota cutoff, no omitted-turns notice", async () => {
    const uwf = await createUwfStore(tmpDir);
    const many: CasRef[] = [];
    for (let i = 0; i < 30; i++) many.push(putTurn(uwf.store, `dev-turn-${i}`));
    await seedLinearChain(uwf, THREAD_ID, [{ role: "developer", turns: many }]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    expect(out).toContain("dev-turn-0");
    expect(out).toContain("dev-turn-29");
    expect(out).not.toContain("omitted");
    expect(out).toContain("## Turn 30");
  });

  test("empty thread (StartNode head): header only, no step groups, no turn blocks", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    expect(out).toContain(`# Thread ${THREAD_ID}`);
    expect(out).not.toContain("## Turn");
    expect(out).not.toContain("✓");
    expect(out).not.toContain("进行中");
  });

  test("a step with turnCount === 0 keeps its (0 turns) header, is not dropped", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "p1")] },
      { role: "developer", turns: [] },
      { role: "reviewer", turns: null }, // detail === null
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    expect(out).toContain("## planner ✓ (1 turns)");
    expect(out).toContain("## developer ✓ (0 turns)");
    expect(out).toContain("## reviewer ✓ (0 turns)");
  });
});

// ── --role selection: the #409 regression ────────────────────────────────────

describe("cmdStepTurns --role filters the chain panorama (#409 regression)", () => {
  test("--role developer on a head=committer thread returns the developer step's turns (NOT empty)", async () => {
    const uwf = await createUwfStore(tmpDir);
    const dev = [putTurn(uwf.store, "dev-1"), putTurn(uwf.store, "dev-2")];
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "plan-1")] },
      { role: "developer", turns: dev },
      { role: "reviewer", turns: [putTurn(uwf.store, "rev-1")] },
      { role: "tester", turns: [putTurn(uwf.store, "test-1")] },
      { role: "committer", turns: [putTurn(uwf.store, "commit-1")] },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "developer", live: false });

    // The chain is walked to the developer step; its turns render — not empty.
    expect(out).toContain("## developer ✓ (2 turns)");
    expect(out).toContain("dev-1");
    expect(out).toContain("dev-2");
    // Only the developer step survives the filter.
    expect(out).not.toContain("## planner");
    expect(out).not.toContain("## committer");
    expect(out).not.toContain("plan-1");
    expect(out).not.toContain("commit-1");
  });

  test("--role planner (head is coder) renders the planner step's turns, never the coder head's", async () => {
    const uwf = await createUwfStore(tmpDir);
    const p1 = putTurn(uwf.store, "p1");
    const c1 = putTurn(uwf.store, "c1");
    const c2 = putTurn(uwf.store, "c2");
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [p1] },
      { role: "coder", turns: [c1, c2] },
    ]);

    const planner = await cmdStepTurns(tmpDir, THREAD_ID, { role: "planner", live: false });
    // #409: walking the chain reaches the earlier planner step — NOT empty.
    expect(planner).toContain("## planner ✓ (1 turns)");
    expect(planner).toContain("p1");
    // The coder head step's turns must NOT surface under --role planner.
    expect(planner).not.toContain("c1");
    expect(planner).not.toContain("c2");
    expect(planner).not.toContain("## coder");
  });

  test("--role coder (head IS coder) renders the coder step's turns in order", async () => {
    const uwf = await createUwfStore(tmpDir);
    const p1 = putTurn(uwf.store, "p1");
    const c1 = putTurn(uwf.store, "c1");
    const c2 = putTurn(uwf.store, "c2");
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [p1] },
      { role: "coder", turns: [c1, c2] },
    ]);

    const coder = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });
    expect(coder).toContain("## coder ✓ (2 turns)");
    expect(coder).toContain("c1");
    expect(coder).toContain("c2");
    expect(coder.indexOf("c1")).toBeLessThan(coder.indexOf("c2"));
    expect(coder).not.toContain("p1");
  });

  test("--role reviewer (never ran) renders empty (no step matches), exit 0", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "p1")] },
      { role: "coder", turns: [putTurn(uwf.store, "c1")] },
    ]);

    const reviewer = await cmdStepTurns(tmpDir, THREAD_ID, { role: "reviewer", live: false });
    expect(reviewer).toContain(`# Thread ${THREAD_ID}`);
    expect(reviewer).not.toContain("## Turn");
    expect(reviewer).not.toContain("p1");
    expect(reviewer).not.toContain("c1");
  });

  test("multiple steps of the same role aggregate (two rounds of developer)", async () => {
    const uwf = await createUwfStore(tmpDir);
    const d1 = putTurn(uwf.store, "dev-round1");
    const d2 = putTurn(uwf.store, "dev-round2");
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "p1")] },
      { role: "developer", turns: [d1] },
      { role: "reviewer", turns: [putTurn(uwf.store, "r1")] },
      { role: "developer", turns: [d2] },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "developer", live: false });
    // Both developer occurrences are kept, in chronological order.
    expect(out).toContain("dev-round1");
    expect(out).toContain("dev-round2");
    expect(out.indexOf("dev-round1")).toBeLessThan(out.indexOf("dev-round2"));
    expect((out.match(/## developer/g) ?? []).length).toBe(2);
    expect(out).not.toContain("## reviewer");
  });

  test("--role is exact-match: 'coder' does not match a 'coder-2' step", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "coder-2", turns: [putTurn(uwf.store, "other-role")] },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });
    expect(out).not.toContain("other-role");
    expect(out).not.toContain("## Turn");
  });
});

// ── per-step read order: active var → detail, source-transparent ─────────────

describe("cmdStepTurns per-step read order (active → detail)", () => {
  test("running vs completed: same step's per-turn blocks are byte-identical, marker flips", async () => {
    const uwf = await createUwfStore(tmpDir);
    const r1 = putTurn(uwf.store, "r1");
    const r2 = putTurn(uwf.store, "r2");
    const r3 = putTurn(uwf.store, "r3");

    // (a) running snapshot: reviewer in flight via active var (StartNode head).
    await seedStartOnly(uwf, THREAD_ID);
    for (const h of [r1, r2, r3]) appendActiveTurn(uwf.store, THREAD_ID, "reviewer", h);
    const running = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    // (b) completed: var gone, same hashes solidified into that step's detail.
    clearActiveTurns(uwf.store, THREAD_ID, "reviewer");
    await seedCompletedStep(uwf, THREAD_ID, "reviewer", [r1, r2, r3]);
    const completed = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    // The per-turn blocks are byte-identical; only the step marker differs.
    expect(turnBlocks(completed)).toBe(turnBlocks(running));
    expect(running).toContain("🔄 进行中");
    expect(completed).toContain("✓");
    expect(completed).toContain("r1");
    expect(completed).toContain("r3");
  });

  test("active var takes precedence over a present detail for the same step/role", async () => {
    const uwf = await createUwfStore(tmpDir);
    // Completed step holds OLD turns…
    const old1 = putTurn(uwf.store, "OLD-DETAIL");
    await seedCompletedStep(uwf, THREAD_ID, "coder", [old1]);
    // …but a fresh active var for the same role holds NEW turns: the var wins.
    const n1 = putTurn(uwf.store, "NEW-ACTIVE");
    appendActiveTurn(uwf.store, THREAD_ID, "coder", n1);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });

    expect(out).toContain("NEW-ACTIVE");
    expect(out).not.toContain("OLD-DETAIL");
    expect(out).toContain("🔄 进行中");
  });

  test("two concurrent in-flight role vars are both shown, each under its own group", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);
    appendActiveTurn(uwf.store, THREAD_ID, "coder", putTurn(uwf.store, "c1"));
    appendActiveTurn(uwf.store, THREAD_ID, "planner", putTurn(uwf.store, "p1"));

    const all = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });
    expect(all).toContain("## coder 🔄 进行中");
    expect(all).toContain("## planner 🔄 进行中");

    // …and --role isolates one of them.
    const coder = await cmdStepTurns(tmpDir, THREAD_ID, { role: "coder", live: false });
    expect(coder).toContain("c1");
    expect(coder).not.toContain("p1");
  });
});

// ── pagination: default-all, --limit/--offset over the flattened sequence ─────

describe("cmdStepTurns pagination (--limit / --offset)", () => {
  // Flattened sequence: [pa, pb, da, db, dc, ra, rb] — global indices 0..6.
  async function seedPaginationFixture(uwf: UwfStore): Promise<void> {
    await seedLinearChain(uwf, THREAD_ID, [
      { role: "planner", turns: [putTurn(uwf.store, "pa"), putTurn(uwf.store, "pb")] },
      {
        role: "developer",
        turns: [putTurn(uwf.store, "da"), putTurn(uwf.store, "db"), putTurn(uwf.store, "dc")],
      },
      { role: "reviewer", turns: [putTurn(uwf.store, "ra"), putTurn(uwf.store, "rb")] },
    ]);
  }

  test("default (no flags): all 7 turns render", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });
    for (const c of ["pa", "pb", "da", "db", "dc", "ra", "rb"]) expect(out).toContain(c);
    expect(out).toContain("## Turn 7");
  });

  test("--limit 3: first 3 turns of the flattened sequence", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, limit: 3 });
    expect(out).toContain("pa");
    expect(out).toContain("pb");
    expect(out).toContain("da");
    expect(out).not.toContain("db");
    expect(out).not.toContain("ra");
  });

  test("--offset 2: skips the first 2, spans into later steps", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 2 });
    expect(out).not.toContain("pa");
    expect(out).not.toContain("pb");
    expect(out).toContain("da");
    expect(out).toContain("rb");
  });

  test("--offset 2 --limit 2: the slice [2,4) over the flat sequence, with global numbering", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 2, limit: 2 });
    expect(out).toContain("da");
    expect(out).toContain("db");
    expect(out).not.toContain("pa");
    expect(out).not.toContain("dc");
    // Global numbering: da is global index 2 → "## Turn 3".
    expect(out).toContain("## Turn 3");
    expect(out).toContain("## Turn 4");
    expect(out).not.toContain("## Turn 1");
  });

  test("a slice spanning a step boundary keeps each turn under its owning group", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    // indices 4..5 → dc (developer), ra (reviewer).
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 4, limit: 2 });
    expect(out).toContain("## developer");
    expect(out).toContain("## reviewer");
    expect(out).toContain("dc");
    expect(out).toContain("ra");
    expect(out).not.toContain("da");
    expect(out).not.toContain("rb");
  });

  test("filter-then-paginate: --role developer --limit 2 → first 2 developer turns only", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, role: "developer", limit: 2 });
    expect(out).toContain("da");
    expect(out).toContain("db");
    expect(out).not.toContain("dc");
    // Not the first 2 turns of the whole thread (pa/pb) filtered down.
    expect(out).not.toContain("pa");
    expect(out).not.toContain("pb");
  });

  test("--offset >= total turns → header/groups only, no turn blocks", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 7 });
    expect(out).not.toContain("## Turn");
    // Group headers still render.
    expect(out).toContain("## planner");
  });

  test("--limit 0 → no turns (the ListOptions convention; absent limit means all)", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, limit: 0 });
    expect(out).not.toContain("## Turn");
    expect(out).toContain("## planner");
  });

  test("--limit larger than remaining clamps (no error)", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPaginationFixture(uwf);
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 5, limit: 100 });
    expect(out).toContain("ra");
    expect(out).toContain("rb");
    expect(out).not.toContain("dc");
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

    await cmdStepTurns(tmpDir, THREAD_ID, {
      role: "coder",
      live: true,
      pollIntervalMs: 0,
      onChunk: (chunk: string) => printed.push(chunk),
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
    expect(joined.match(/L1/g) ?? []).toHaveLength(1);
    expect(joined.match(/L2/g) ?? []).toHaveLength(1);
    expect(joined.match(/L3/g) ?? []).toHaveLength(1);
    expect(joined.indexOf("L1")).toBeLessThan(joined.indexOf("L2"));
    expect(joined.indexOf("L2")).toBeLessThan(joined.indexOf("L3"));
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

  test("without --role, --live follows the thread's in-flight role", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedStartOnly(uwf, THREAD_ID);
    // The step is already emitting when --live starts: its active var is present
    // at invocation, so the followed role is discovered from it (no --role given).
    const t1 = putTurn(uwf.store, "AUTO1");
    appendActiveTurn(uwf.store, THREAD_ID, "coder", t1);

    const printed: string[] = [];
    let tick = 0;
    const t2 = putTurn(uwf.store, "AUTO2");
    await cmdStepTurns(tmpDir, THREAD_ID, {
      live: true,
      pollIntervalMs: 0,
      onChunk: (chunk: string) => printed.push(chunk),
      isRunning: async () => tick < 2,
      sleep: async () => {
        tick += 1;
        if (tick === 1) appendActiveTurn(uwf.store, THREAD_ID, "coder", t2);
        else if (tick >= 2) clearActiveTurns(uwf.store, THREAD_ID, "coder");
      },
    });

    // The coder active var was discovered and followed without an explicit --role.
    const joined = printed.join("\n");
    expect(joined).toContain("AUTO1");
    expect(joined).toContain("AUTO2");
  });

  test("multi-step run: exit reconcile is role-scoped — never emits a different role's turns", async () => {
    // Regression for #409 (live counterpart). In a multi-step run the running
    // marker is held for the whole loop, so the thread stays "running" while the
    // head advances coder → reviewer. A `--live --role coder` follower streams the
    // coder turns; by exit the head StepNode is the reviewer step. The reconcile
    // MUST walk the chain to the *coder* step (not blindly the head), else the
    // reviewer tail leaks as continued coder turns.
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
      isRunning: async () => tick < 3,
      sleep: async () => {
        tick += 1;
        if (tick === 1) appendActiveTurn(uwf.store, THREAD_ID, "coder", c1);
        else if (tick === 2) appendActiveTurn(uwf.store, THREAD_ID, "coder", c2);
        else if (tick === 3) {
          // coder step ends: its var is solidified+deleted and the head advances
          // to the (completed) reviewer step while the thread stays "running".
          clearActiveTurns(uwf.store, THREAD_ID, "coder");
          await seedCompletedStep(uwf, THREAD_ID, "reviewer", [r1, r2, r3]);
        }
      },
    });

    const joined = printed.join("\n");
    expect(joined.match(/LC1/g) ?? []).toHaveLength(1);
    expect(joined.match(/LC2/g) ?? []).toHaveLength(1);
    expect(joined).not.toContain("LR1");
    expect(joined).not.toContain("LR2");
    expect(joined).not.toContain("LR3");
  });
});
