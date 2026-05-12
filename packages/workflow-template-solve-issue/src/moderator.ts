import { END, type ModeratorTable, START } from "@uncaged/workflow-runtime";

import type { SolveIssueMeta } from "./roles.js";

const table: ModeratorTable<SolveIssueMeta> = {
  [START]: [{ condition: "FALLBACK", role: "preparer" }],
  preparer: [{ condition: "FALLBACK", role: "developer" }],
  developer: [{ condition: "FALLBACK", role: "submitter" }],
  submitter: [{ condition: "FALLBACK", role: END }],
};

export { table as solveIssueTable };
