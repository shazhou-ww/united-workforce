/**
 * Phase 3 (#421) — buildTurnsPanorama rewritten to use owner-based segmentation.
 *
 * This is the consumer-side rewrite that root-causes #412 (recurring role in-flight
 * mis-attribution). The panorama now:
 *   1. Walks the step chain (step-start prev) instead of role-keyed vars
 *   2. Each segment's turns are sourced via `turnsOfStep(turnHead, stepStartHash)`
 *   3. In-flight detection: active-step matches step-start AND no step-complete
 *   4. edgePrompt is read directly from step-start
 *
 * Covers the specs:
 *   - step-turns-panorama-owner-segmentation.md
 *   - step-turns-panorama-412-recurring-role.md
 *   - step-turns-panorama-role-filter.md
 *   - step-turns-panorama-pagination.md
 *   - step-turns-panorama-live-mode.md
 *   - step-turns-panorama-in-flight-detection.md
 *   - step-turns-panorama-edge-prompt.md
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdStepTurns } from "../commands/step.js";
import {
  createUwfStore,
  getActiveTurnHead,
  setActiveStep,
  setActiveTurnHead,
  setThread,
  turnsOfStep,
  type UwfStore,
  walkTurnChain,
  writeStepStart,
  writeTurnNode,
} from "../store.js";

// ── schemas ─────────────────────────────────────────────────────────────────

const DETAIL_SCHEMA = {
  title: "broker-detail-phase3",
  type: "object" as const,
  required: ["sessionId", "duration", "turnCount"],
  properties: {
    sessionId: { type: "string" as const },
    duration: { type: "integer" as const },
    turnCount: { type: "integer" as const },
  },
  additionalProperties: false,
};

// ── fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "step-turns-phase3-"));
  const casDir = join(tmpDir, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_HOME = casDir;
});

afterEach(async () => {
  if (savedOcasHome === undefined) delete process.env.OCAS_HOME;
  else process.env.OCAS_HOME = savedOcasHome;
  await rm(tmpDir, { recursive: true, force: true });
});

const THREAD_ID = "06FDPANORAMAPH3OWNERTEST1" as ThreadId;

/**
 * Seed a complete Phase 3 scenario:
 * - Creates start node
 * - Creates step-starts linked via prev chain
 * - Creates turns linked via prev chain, each with owner pointing to its step-start
 * - Creates StepNodes for completed steps (for backward compat with walkChain)
 * - Sets thread head (StepNode or StartNode), active-step (if in-flight), active-turn-head
 *
 * Key insight: Thread head still points to StepNode (or StartNode), step-start is
 * a parallel chain. The panorama should read from active-turn-head and walk
 * owner -> step-start -> prev to reconstruct segments.
 *
 * Returns { startHash, stepStarts, stepNodes, turns } for verification.
 */
async function seedPhase3Chain(
  uwf: UwfStore,
  threadId: ThreadId,
  steps: {
    role: string;
    edgePrompt: string;
    turnContents: string[];
    inFlight: boolean;
  }[],
): Promise<{
  startHash: CasRef;
  stepStarts: CasRef[];
  stepNodes: (CasRef | null)[];
  turns: CasRef[][];
}> {
  // Create workflow and start node
  const workflowHash = uwf.store.cas.put(uwf.schemas.workflow, {
    version: 1,
    name: "phase3-test-wf",
    description: "phase3",
    roles: {},
    graph: {},
  }) as CasRef;
  const startHash = uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: workflowHash,
    prompt: "task",
    cwd: "/tmp/work",
  }) as CasRef;

  const detailSchemaHash = putSchema(uwf.store, DETAIL_SCHEMA);
  const outputHash = uwf.store.cas.put(uwf.schemas.text, "output") as CasRef;

  const stepStarts: CasRef[] = [];
  const stepNodes: (CasRef | null)[] = [];
  const allTurns: CasRef[][] = [];
  let prevStepStart: CasRef | null = null;
  let prevStepNode: CasRef | null = null;
  let prevTurn: CasRef | null = null;
  let inFlightStepStart: CasRef | null = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    // Write step-start (new Phase 2 node)
    const stepStart = writeStepStart(uwf, {
      role: step.role,
      edgePrompt: step.edgePrompt,
      stepIndex: i,
      prev: prevStepStart,
      start: startHash,
      startedAtMs: 1000 + i * 1000,
      cwd: "/tmp/work",
    });
    stepStarts.push(stepStart);

    // Write turns for this step
    const stepTurns: CasRef[] = [];
    for (const content of step.turnContents) {
      const turn = writeTurnNode(uwf, {
        role: "assistant",
        content,
        prev: prevTurn,
        owner: stepStart,
      });
      stepTurns.push(turn);
      prevTurn = turn;
    }
    allTurns.push(stepTurns);

    // Write StepNode if not in-flight (for backward compat with thread head)
    if (step.inFlight) {
      stepNodes.push(null);
      inFlightStepStart = stepStart;
    } else {
      const detail = uwf.store.cas.put(detailSchemaHash, {
        sessionId: `ses_${step.role}_${i}`,
        duration: 5,
        turnCount: step.turnContents.length,
      }) as CasRef;
      // Write a StepNode (legacy format for thread head)
      const stepNode = uwf.store.cas.put(uwf.schemas.stepNode, {
        start: startHash,
        prev: prevStepNode,
        role: step.role,
        output: outputHash,
        detail,
        agent: "test-agent",
        edgePrompt: step.edgePrompt,
        startedAtMs: 1000 + i * 1000,
        completedAtMs: 2000 + i * 1000,
        cwd: "/tmp/work",
        assembledPrompt: null,
        usage: null,
        previousAttempts: null,
      }) as CasRef;
      stepNodes.push(stepNode);
      prevStepNode = stepNode;
    }

    prevStepStart = stepStart;
  }

  // Set thread head to latest StepNode or StartNode if no completes
  const lastStepNode = stepNodes.filter((n) => n !== null).pop();
  const threadHead = lastStepNode ?? startHash;

  setThread(uwf.varStore, threadId, {
    head: threadHead,
    status: inFlightStepStart !== null ? "running" : "idle",
    suspendedRole: null,
    suspendMessage: null,
    completedAt: null,
  });

  // Set active-step if in-flight
  if (inFlightStepStart !== null) {
    setActiveStep(uwf.store, threadId, inFlightStepStart);
  }

  // Set active-turn-head to the latest turn
  if (prevTurn !== null) {
    setActiveTurnHead(uwf.store, threadId, prevTurn);
  }

  return { startHash, stepStarts, stepNodes, turns: allTurns };
}

// ── spec: step-turns-panorama-owner-segmentation.md ─────────────────────────

describe("buildTurnsPanorama segments turns by step-start owner (#421)", () => {
  test("3 completed steps: each group shows only turns with matching owner", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "planner", edgePrompt: "Plan the task", turnContents: ["t0", "t1"], inFlight: false },
      { role: "developer", edgePrompt: "Implement", turnContents: ["t2", "t3"], inFlight: false },
      { role: "reviewer", edgePrompt: "Review", turnContents: ["t4", "t5"], inFlight: false },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    // All three step groups present in step-chain order
    expect(out).toContain("## planner");
    expect(out).toContain("## developer");
    expect(out).toContain("## reviewer");
    expect(out.indexOf("## planner")).toBeLessThan(out.indexOf("## developer"));
    expect(out.indexOf("## developer")).toBeLessThan(out.indexOf("## reviewer"));

    // Each group shows only its own turns (no cross-segment leakage)
    const plannerSection = out.slice(out.indexOf("## planner"), out.indexOf("## developer"));
    const developerSection = out.slice(out.indexOf("## developer"), out.indexOf("## reviewer"));
    const reviewerSection = out.slice(out.indexOf("## reviewer"));

    expect(plannerSection).toContain("t0");
    expect(plannerSection).toContain("t1");
    expect(plannerSection).not.toContain("t2");

    expect(developerSection).toContain("t2");
    expect(developerSection).toContain("t3");
    expect(developerSection).not.toContain("t4");

    expect(reviewerSection).toContain("t4");
    expect(reviewerSection).toContain("t5");
    expect(reviewerSection).not.toContain("t0");

    // Each group is marked completed
    expect(out).toMatch(/## planner.*✓/);
    expect(out).toMatch(/## developer.*✓/);
    expect(out).toMatch(/## reviewer.*✓/);
  });

  test("owner filtering via turnsOfStep returns correct subset", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { stepStarts } = await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "planner", edgePrompt: "Plan", turnContents: ["p0", "p1"], inFlight: false },
      { role: "developer", edgePrompt: "Dev", turnContents: ["d0", "d1"], inFlight: false },
      { role: "reviewer", edgePrompt: "Rev", turnContents: ["r0", "r1"], inFlight: false },
    ]);

    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID)!;

    // Each step-start should own exactly its 2 turns
    expect(turnsOfStep(uwf, turnHead, stepStarts[0]!)).toHaveLength(2);
    expect(turnsOfStep(uwf, turnHead, stepStarts[1]!)).toHaveLength(2);
    expect(turnsOfStep(uwf, turnHead, stepStarts[2]!)).toHaveLength(2);

    // Full turn chain has 6 turns
    expect(walkTurnChain(uwf, turnHead)).toHaveLength(6);
  });
});

// ── spec: step-turns-panorama-412-recurring-role.md ─────────────────────────

describe("#412 recurring role with in-flight correctly handled (#421)", () => {
  test("developer→reviewer→developer(in-flight): each segment correctly attributed", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "developer", edgePrompt: "Round 1", turnContents: ["t1", "t2"], inFlight: false },
      { role: "reviewer", edgePrompt: "Review", turnContents: ["t3", "t4"], inFlight: false },
      {
        role: "developer",
        edgePrompt: "Round 2",
        turnContents: ["t5", "t6", "t7"],
        inFlight: true,
      },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    // Three groups in chronological order
    const groups = out.match(/## (developer|reviewer)/g);
    expect(groups).toEqual(["## developer", "## reviewer", "## developer"]);

    // Round 1 developer: completed, 2 turns
    const firstDev = out.indexOf("## developer");
    const reviewer = out.indexOf("## reviewer");
    const secondDev = out.indexOf("## developer", reviewer + 1);

    const r1Section = out.slice(firstDev, reviewer);
    expect(r1Section).toContain("✓");
    expect(r1Section).not.toContain("进行中");
    expect(r1Section).toContain("t1");
    expect(r1Section).toContain("t2");
    expect(r1Section).not.toContain("t5");

    // Reviewer: completed
    const revSection = out.slice(reviewer, secondDev);
    expect(revSection).toContain("✓");
    expect(revSection).toContain("t3");
    expect(revSection).toContain("t4");

    // Round 2 developer: in-flight, 3 turns
    const r2Section = out.slice(secondDev);
    expect(r2Section).toContain("🔄 进行中");
    expect(r2Section).not.toContain("✓");
    expect(r2Section).toContain("t5");
    expect(r2Section).toContain("t6");
    expect(r2Section).toContain("t7");
    expect(r2Section).not.toContain("t1");
  });

  test("same role multi-round: turns never mixed between segments", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { stepStarts } = await seedPhase3Chain(uwf, THREAD_ID, [
      {
        role: "developer",
        edgePrompt: "R1",
        turnContents: ["dev_r1_t1", "dev_r1_t2"],
        inFlight: false,
      },
      { role: "reviewer", edgePrompt: "Rev", turnContents: ["rev_t1"], inFlight: false },
      {
        role: "developer",
        edgePrompt: "R2",
        turnContents: ["dev_r2_t1", "dev_r2_t2", "dev_r2_t3"],
        inFlight: false,
      },
    ]);

    // Verify turn ownership in CAS
    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID)!;
    const dev1Turns = turnsOfStep(uwf, turnHead, stepStarts[0]!);
    const revTurns = turnsOfStep(uwf, turnHead, stepStarts[1]!);
    const dev2Turns = turnsOfStep(uwf, turnHead, stepStarts[2]!);

    expect(dev1Turns).toHaveLength(2);
    expect(revTurns).toHaveLength(1);
    expect(dev2Turns).toHaveLength(3);

    // Verify content via panorama
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });
    expect(out.match(/dev_r1/g)).toHaveLength(2);
    expect(out.match(/dev_r2/g)).toHaveLength(3);
    expect(out.match(/rev_t/g)).toHaveLength(1);
  });
});

// ── spec: step-turns-panorama-role-filter.md ─────────────────────────────────

describe("--role filters by step-start role, preserving all segments (#421)", () => {
  test("--role developer shows all developer segments", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "developer", edgePrompt: "R1", turnContents: ["d1"], inFlight: false },
      { role: "reviewer", edgePrompt: "Rev", turnContents: ["r1"], inFlight: false },
      { role: "developer", edgePrompt: "R2", turnContents: ["d2"], inFlight: false },
      { role: "reviewer", edgePrompt: "Rev2", turnContents: ["r2"], inFlight: false },
      { role: "developer", edgePrompt: "R3", turnContents: ["d3"], inFlight: false },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "developer", live: false });

    // 3 developer groups
    expect((out.match(/## developer/g) ?? []).length).toBe(3);

    // No reviewer groups
    expect(out).not.toContain("## reviewer");

    // All developer turns present
    expect(out).toContain("d1");
    expect(out).toContain("d2");
    expect(out).toContain("d3");

    // No reviewer turns
    expect(out).not.toContain("r1");
    expect(out).not.toContain("r2");
  });

  test("--role for non-existent role returns empty panorama", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "developer", edgePrompt: "Dev", turnContents: ["d1"], inFlight: false },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { role: "tester", live: false });

    expect(out).toContain(`# Thread ${THREAD_ID}`);
    expect(out).not.toContain("## Turn");
    expect(out).not.toContain("d1");
  });
});

// ── spec: step-turns-panorama-pagination.md ──────────────────────────────────

describe("--limit/--offset paginates on flattened cross-step turn sequence (#421)", () => {
  test("pagination crosses step boundaries correctly", async () => {
    const uwf = await createUwfStore(tmpDir);
    // 12 turns total: 4 per step
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "step0", edgePrompt: "S0", turnContents: ["t0", "t1", "t2", "t3"], inFlight: false },
      { role: "step1", edgePrompt: "S1", turnContents: ["t4", "t5", "t6", "t7"], inFlight: false },
      {
        role: "step2",
        edgePrompt: "S2",
        turnContents: ["t8", "t9", "t10", "t11"],
        inFlight: false,
      },
    ]);

    // --offset 5 --limit 4: indices 5,6,7,8 → t5,t6,t7,t8
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 5, limit: 4 });

    // Should span step1 (t5,t6,t7) and step2 (t8)
    expect(out).toContain("t5");
    expect(out).toContain("t6");
    expect(out).toContain("t7");
    expect(out).toContain("t8");
    expect(out).not.toContain("t4");
    expect(out).not.toContain("t9");

    // Global indices: Turn 6, Turn 7, Turn 8, Turn 9 (1-based)
    expect(out).toContain("## Turn 6");
    expect(out).toContain("## Turn 9");
    expect(out).not.toContain("## Turn 5");
    expect(out).not.toContain("## Turn 10");
  });

  test("groups with no surviving turns after pagination still show header", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "step0", edgePrompt: "S0", turnContents: ["t0", "t1"], inFlight: false },
      { role: "step1", edgePrompt: "S1", turnContents: ["t2", "t3"], inFlight: false },
    ]);

    // --offset 0 --limit 2: only step0 turns survive
    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false, offset: 0, limit: 2 });

    // step1 header should still appear (empty)
    expect(out).toContain("## step0");
    expect(out).toContain("## step1");
    expect(out).toContain("t0");
    expect(out).toContain("t1");
    expect(out).not.toContain("t2");
  });
});

// ── spec: step-turns-panorama-in-flight-detection.md ─────────────────────────

describe("in-flight detection via active-step + missing step-complete (#421)", () => {
  test("completed step (has step-complete) is marked ✓ even if active-step points elsewhere", async () => {
    const uwf = await createUwfStore(tmpDir);
    await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "step1", edgePrompt: "S1", turnContents: ["t1"], inFlight: false },
      { role: "step2", edgePrompt: "S2", turnContents: ["t2"], inFlight: true },
    ]);

    const out = await cmdStepTurns(tmpDir, THREAD_ID, { live: false });

    // step1 completed: ✓
    expect(out).toMatch(/## step1.*✓/);

    // step2 in-flight: 🔄 进行中
    expect(out).toMatch(/## step2.*🔄 进行中/);
  });

  test("in-flight step is detected by active-step match AND no step-complete", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { stepStarts } = await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "done", edgePrompt: "D", turnContents: ["d1"], inFlight: false },
      { role: "wip", edgePrompt: "W", turnContents: ["w1"], inFlight: true },
    ]);

    // Verify active-step points to the in-flight step-start
    const uwf2 = await createUwfStore(tmpDir);
    const activeStep = uwf2.varStore.list({ exactName: `@uwf/active-step/${THREAD_ID}` });
    expect(activeStep.length).toBe(1);
    expect(activeStep[0]!.value).toBe(stepStarts[1]);
  });
});

// ── spec: step-turns-panorama-live-mode.md ───────────────────────────────────

describe("--live follows active-turn-head growth (#421)", () => {
  test("live mode polls active-turn-head and prints new turns", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { stepStarts } = await seedPhase3Chain(uwf, THREAD_ID, [
      { role: "coder", edgePrompt: "Code", turnContents: ["initial"], inFlight: true },
    ]);

    const printed: string[] = [];
    let tick = 0;
    const stepStart = stepStarts[0]!;
    let prevTurn = getActiveTurnHead(uwf.store, THREAD_ID)!;

    await cmdStepTurns(tmpDir, THREAD_ID, {
      role: "coder",
      live: true,
      pollIntervalMs: 0,
      onChunk: (chunk: string) => printed.push(chunk),
      isRunning: async () => tick < 3,
      sleep: async () => {
        tick += 1;
        if (tick === 1) {
          const t = writeTurnNode(uwf, {
            role: "assistant",
            content: "live1",
            prev: prevTurn,
            owner: stepStart,
          });
          setActiveTurnHead(uwf.store, THREAD_ID, t);
          prevTurn = t;
        } else if (tick === 2) {
          const t = writeTurnNode(uwf, {
            role: "assistant",
            content: "live2",
            prev: prevTurn,
            owner: stepStart,
          });
          setActiveTurnHead(uwf.store, THREAD_ID, t);
          prevTurn = t;
        }
      },
    });

    const joined = printed.join("\n");
    expect(joined).toContain("initial");
    expect(joined).toContain("live1");
    expect(joined).toContain("live2");
  });
});

// ── spec: step-turns-panorama-edge-prompt.md ─────────────────────────────────

describe("edgePrompt readable from step-start (#421)", () => {
  test("step-start stores edgePrompt correctly", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { stepStarts } = await seedPhase3Chain(uwf, THREAD_ID, [
      {
        role: "planner",
        edgePrompt: "Initial prompt from user",
        turnContents: ["t1"],
        inFlight: false,
      },
      {
        role: "developer",
        edgePrompt: "Implement the plan from planner",
        turnContents: ["t2"],
        inFlight: false,
      },
    ]);

    // Read step-start nodes and verify edgePrompt
    const ss1 = uwf.store.cas.get(stepStarts[0]!);
    const ss2 = uwf.store.cas.get(stepStarts[1]!);

    expect((ss1?.payload as { edgePrompt: string }).edgePrompt).toBe("Initial prompt from user");
    expect((ss2?.payload as { edgePrompt: string }).edgePrompt).toBe(
      "Implement the plan from planner",
    );
  });
});
