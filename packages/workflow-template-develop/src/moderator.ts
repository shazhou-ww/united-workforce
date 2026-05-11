import {
  END,
  type ModeratorCondition,
  type ModeratorTable,
  START,
  tableToModerator,
} from "@uncaged/workflow-runtime";

import type { DevelopMeta } from "./roles.js";

// ── Helpers ────────────────────────────────────────────────────────

function coderFinishedAllPlannedPhases(
  phases: ReadonlyArray<{ hash: string }>,
  coderCompletedPhases: ReadonlyArray<string>,
): boolean {
  if (phases.length === 0) {
    return true;
  }
  const plannedHashes = new Set(phases.map((p) => p.hash));
  const lastHash = phases[phases.length - 1].hash;
  const explicit = new Set(coderCompletedPhases.filter((h) => plannedHashes.has(h)));
  if (phases.every((p) => explicit.has(p.hash))) {
    return true;
  }
  if (coderCompletedPhases.some((h) => h === lastHash)) {
    return true;
  }
  return false;
}

// ── Conditions ─────────────────────────────────────────────────────

const allPhasesComplete: ModeratorCondition<DevelopMeta> = {
  name: "allPhasesComplete",
  description: "All planned phases have been completed by the coder",
  check: (ctx) => {
    const plannerStep = ctx.steps.find((s) => s.role === "planner");
    if (plannerStep === undefined) {
      return true;
    }
    const phases = plannerStep.meta.phases;
    if (!Array.isArray(phases)) {
      return true;
    }
    const coderCompletedPhases = ctx.steps
      .filter((s) => s.role === "coder")
      .map((s) => s.meta.completedPhase);
    return coderFinishedAllPlannedPhases(phases, coderCompletedPhases);
  },
};

const hasRoundsRemaining: ModeratorCondition<DevelopMeta> = {
  name: "hasRoundsRemaining",
  description: "There are rounds remaining before hitting maxRounds",
  check: (ctx) => ctx.steps.length < ctx.start.meta.maxRounds - 1,
};

const reviewApproved: ModeratorCondition<DevelopMeta> = {
  name: "reviewApproved",
  description: "The last reviewer approved the changes",
  check: (ctx) => {
    const last = ctx.steps[ctx.steps.length - 1];
    return last.role === "reviewer" && last.meta.status === "approved";
  },
};

const testsPassed: ModeratorCondition<DevelopMeta> = {
  name: "testsPassed",
  description: "The last tester reported tests passed",
  check: (ctx) => {
    const last = ctx.steps[ctx.steps.length - 1];
    return last.role === "tester" && last.meta.status === "passed";
  },
};

// ── Transition Table ───────────────────────────────────────────────

const table: ModeratorTable<DevelopMeta> = {
  [START]: [{ condition: "FALLBACK", role: "planner" }],
  planner: [{ condition: "FALLBACK", role: "coder" }],
  coder: [
    { condition: allPhasesComplete, role: "reviewer" },
    { condition: hasRoundsRemaining, role: "coder" },
    { condition: "FALLBACK", role: END },
  ],
  reviewer: [
    { condition: reviewApproved, role: "tester" },
    { condition: hasRoundsRemaining, role: "coder" },
    { condition: "FALLBACK", role: END },
  ],
  tester: [
    { condition: testsPassed, role: "committer" },
    { condition: hasRoundsRemaining, role: "coder" },
    { condition: "FALLBACK", role: END },
  ],
  committer: [{ condition: "FALLBACK", role: END }],
};

export const developModerator = tableToModerator(table);
