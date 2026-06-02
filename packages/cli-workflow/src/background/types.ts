import type { CasRef, ThreadId } from "@united-workforce/protocol";

/** Marker file stored at ~/.uwf/running/<thread-id>.json */
export type RunningMarker = {
  thread: ThreadId;
  workflow: CasRef;
  pid: number;
  startedAt: number;
};
