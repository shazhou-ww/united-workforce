import type { Moderator, ModeratorContext } from "@uncaged/workflow";
import { END } from "@uncaged/workflow";

import type { SolveIssueMeta } from "./roles.js";

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
    return "preparer";
  }

  const last = ctx.steps[ctx.steps.length - 1];

  if (last.role === "preparer") {
    return "planner";
  }

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
