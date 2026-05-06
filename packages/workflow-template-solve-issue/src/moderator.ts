import type { Moderator } from "@uncaged/workflow";
import { END } from "@uncaged/workflow";

import type { SolveIssueMeta } from "./roles.js";

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
    return "reviewer";
  }

  if (last.role === "reviewer") {
    if (last.meta.approved === true) {
      return "committer";
    }
    if (ctx.steps.length < maxRounds - 1) {
      return "coder";
    }
    return END;
  }

  if (last.role === "committer") {
    return END;
  }

  return END;
};
