// ── CAS thread chain nodes (RFC: CAS-based thread storage) ──────────

export type StartNodePayload = {
  name: string;
  hash: string;
  maxRounds: number;
  depth: number;
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
