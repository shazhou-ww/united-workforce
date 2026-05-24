import type { CasRef, ThreadId } from "@uncaged/workflow-protocol";

/** Marker file stored at ~/.uncaged/workflow/running/<thread-id>.json */
export type RunningMarker = {
  thread: ThreadId;
  workflow: CasRef;
  pid: number;
  startedAt: number;
};
