import type { CasStore } from "@uncaged/workflow-cas";
import type { RoleOutput } from "@uncaged/workflow-runtime";
import type { Result } from "@uncaged/workflow-util";

export type SupervisorDecision = "continue" | "stop";

export type ExecuteThreadIo = {
  threadId: string;
  hash: string;
  infoJsonlPath: string;
  cas: CasStore;
};

/** CAS chain tail state before the next appended {@link StateNode}. */
export type ChainState = {
  parentStateHash: string | null;
  parentAncestors: readonly string[];
};

export const EMPTY_CHAIN_STATE: ChainState = { parentStateHash: null, parentAncestors: [] };

/**
 * When forking, the worker continues from an existing {@link StartNode} plus an optional
 * branch marker {@link StateNode} instead of allocating a new start blob.
 */
export type ForkContinuationOptions = {
  startHash: string;
  forkHeadHash: string;
  initialChain: ChainState;
};

/** One replayed role step (prefill) before the generator runs (same layout as disk replay rows). */
export type PrefilledDiskStep = {
  role: string;
  contentHash: string;
  meta: Record<string, unknown>;
  refs: string[];
  timestamp: number;
};

export type ExecuteThreadOptions = {
  maxRounds: number;
  /** Passed to the bundle thread context as `ThreadContext.depth`. */
  depth: number;
  signal: AbortSignal;
  /** Invoked after each successful yield (and outer-loop checks); used for pause/resume. */
  awaitAfterEachYield: () => Promise<void>;
  /** When non-null, written into the start record so tooling can trace lineage. */
  forkSourceThreadId: string | null;
  /**
   * When non-null, replays these steps into CAS before the generator runs.
   * Must match `input.steps` length and order when present.
   */
  prefilledDiskSteps: PrefilledDiskStep[] | null;
  /** When non-null, skip creating a new {@link StartNode} and continue this CAS chain. */
  forkContinuation: ForkContinuationOptions | null;
  /**
   * When non-null, must match `input.steps.length`; supplies persisted timestamps for
   * {@link ThreadContext.steps} (used when restoring history without prefilled CAS replay).
   */
  replayTimestamps: readonly number[] | null;
  /** Workspace root containing `workflow.yaml`; used to resolve the `extract` scene for meta extraction. */
  storageRoot: string;
};

export type CasForkPlan = {
  workflowName: string;
  hash: string;
  sourceThreadId: string;
  prompt: string;
  runOptions: { maxRounds: number; depth: number };
  steps: RoleOutput[];
  stepTimestamps: number[];
  forkContinuation: ForkContinuationOptions;
};

export type GcResult = {
  /** Count of root hashes seeded from thread indexes (`head`/`start` per entry). */
  scannedThreads: number;
  /** Reachable CAS blobs after the mark phase. */
  activeRefs: number;
  deletedEntries: number;
  deletedHashes: string[];
};

export type ThreadPauseGate = {
  awaitAfterYield: () => Promise<void>;
  pause: () => Result<void, string>;
  resume: () => Result<void, string>;
  isPaused: () => boolean;
};
