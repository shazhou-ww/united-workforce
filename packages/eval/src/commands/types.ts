import type { CasRef } from "@united-workforce/protocol";

/** Summary row for the `list` command: one indexed eval run. */
export type EvalListEntry = {
  task: string;
  overall: number;
  timestamp: number;
  hash: CasRef;
};
