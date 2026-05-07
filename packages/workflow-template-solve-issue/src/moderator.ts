import type { Moderator, ModeratorContext } from "@uncaged/workflow";
import { END } from "@uncaged/workflow";

import type { SolveIssueMeta } from "./roles.js";

const COMPLETED_PHASE_SENTINELS = new Set(["all-done", "all_done", "complete"]);

function coderFinishedAllPlannedPhases(
  phases: ReadonlyArray<{ name: string }>,
  coderCompletedPhases: ReadonlyArray<string>,
): boolean {
  if (phases.length === 0) {
    return true;
  }
  const plannedNames = new Set(phases.map((p) => p.name));
  const lastName = phases[phases.length - 1].name;
  const explicit = new Set(coderCompletedPhases.filter((name) => plannedNames.has(name)));
  if (phases.every((p) => explicit.has(p.name))) {
    return true;
  }
  // One-shot runs often report only the final phase; treat that as the full plan done.
  if (coderCompletedPhases.some((name) => name === lastName)) {
    return true;
  }
  return coderCompletedPhases.some(
    (name) => !plannedNames.has(name) && COMPLETED_PHASE_SENTINELS.has(name),
  );
}

function nextAfterCoder(
  ctx: ModeratorContext<SolveIssueMeta>,
  maxRounds: number,
): (keyof SolveIssueMeta & string) | typeof END {
  const plannerStep = ctx.steps.find((s) => s.role === "planner");
  if (plannerStep === undefined) {
    return "reviewer";
  }
  const phases = plannerStep.meta.phases;
  const coderCompletedPhases = ctx.steps
    .filter((s) => s.role === "coder")
    .map((s) => s.meta.completedPhase);
  const allDone = coderFinishedAllPlannedPhases(phases, coderCompletedPhases);
  if (allDone) {
    return "reviewer";
  }
  if (ctx.steps.length < maxRounds - 1) {
    return "coder";
  }
  return END;
}

export const solveIssueModerator: Moderator<SolveIssueMeta> = (ctx) => {
  const maxRounds = ctx.start.meta.maxRounds;

  if (ctx.steps.length === 0) {
    return "planner";
  }

  const last = ctx.steps[ctx.steps.length - 1];

  if (last.role === "planner") {
    return "coder";
  }

  if (last.role === "coder") {
    return nextAfterCoder(ctx, maxRounds);
  }

  if (last.role === "reviewer") {
    if (last.meta.status === "approved") {
      return "committer";
    }
    if (ctx.steps.length < maxRounds - 1) {
      return "coder";
    }
    return END;
  }

  if (last.role === "committer") {
    if (last.meta.status === "recoverable" && ctx.steps.length < maxRounds - 1) {
      return "coder";
    }
    return END;
  }

  return END;
};
