// ── CAS thread chain nodes (RFC: CAS-based thread storage) ──────────

export type StartNodePayload = {
  name: string;
  hash: string;
  depth: number;
  /** Parent thread's head state hash at spawn time. `null` for top-level workflows. */
  parentState: string | null;
};

export type StartNode = {
  type: "start";
  payload: StartNodePayload;
  refs: string[];
};

export type StateNodePayload = {
  role: string;
  meta: Record<string, unknown>;
  start: string;
  content: string;
  ancestors: string[];
  compact: string | null;
  timestamp: number;
  /** Child thread's final state hash (workflow-as-agent). `null` when no child spawned. */
  childThread: string | null;
};

export type StateNode = {
  type: "state";
  payload: StateNodePayload;
  refs: string[];
};

export type ContentMerkleNode = {
  type: "content";
  payload: string;
  refs: string[];
};
