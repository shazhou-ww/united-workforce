import type { Moderator } from "@uncaged/workflow";
import { END } from "@uncaged/workflow";

import type { SolveIssueMeta } from "./roles.js";

export const solveIssueModerator: Moderator<SolveIssueMeta> = (ctx) => {
  if (ctx.steps.length === 0) {
    return "preparer";
  }

  const last = ctx.steps[ctx.steps.length - 1];

  if (last.role === "preparer") {
    return "developer";
  }

  if (last.role === "developer") {
    return "submitter";
  }

  if (last.role === "submitter") {
    return END;
  }

  return END;
};
