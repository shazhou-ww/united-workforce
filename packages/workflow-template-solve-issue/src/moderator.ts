import { END, type ModeratorTable, START, tableToModerator } from "@uncaged/workflow-runtime";

import type { SolveIssueMeta } from "./roles.js";

const table: ModeratorTable<SolveIssueMeta> = {
  [START]: [{ condition: "FALLBACK", role: "preparer" }],
  preparer: [{ condition: "FALLBACK", role: "developer" }],
  developer: [{ condition: "FALLBACK", role: "submitter" }],
  submitter: [{ condition: "FALLBACK", role: END }],
};

export const solveIssueModerator = tableToModerator(table);
