import type { RoleOutput } from "@uncaged/workflow-runtime";
import type { CasStore } from "../cas/index.js";
import type { Result } from "../util/index.js";

export type SupervisorDecision = "continue" | "stop";

export type ExecuteThreadIo = {
  threadId: string;
  hash: string;
  dataJsonlPath: string;
  infoJsonlPath: string;
  cas: CasStore;
};

/** One persisted role line in `.data.jsonl` (engine adds these for fork replay before running the generator). */
export type PrefilledDiskStep = {
  role: string;
  contentHash: string;
  meta: Record<string, unknown>;
  refs: string[];
  timestamp: number;
};

export type ExecuteThreadOptions = {
  maxRounds: number;
  /** Passed to the bundle as `WorkflowFnOptions.depth`. */
  depth: number;
  signal: AbortSignal;
  /** Invoked after each successful yield (and outer-loop checks); used for pause/resume. */
  awaitAfterEachYield: () => Promise<void>;
  /** When non-null, written into the start record so tooling can trace lineage. */
  forkSourceThreadId: string | null;
  /**
   * Written to `.data.jsonl` immediately after the start record, before the generator runs.
   * Must match `input.steps` length and order when present.
   */
  prefilledDiskSteps: PrefilledDiskStep[] | null;
  /** Workspace root containing `workflow.yaml`; used to resolve the `extract` scene for meta extraction. */
  storageRoot: string;
};

/** Role steps replayed from `.data.jsonl`, including persisted timestamps. */
export type ForkHistoricalStep = RoleOutput & { timestamp: number };

export type ParsedThreadStartRecord = {
  workflowName: string;
  hash: string;
  threadId: string;
  prompt: string;
  maxRounds: number;
  depth: number;
};

export type ForkPlan = {
  workflowName: string;
  hash: string;
  sourceThreadId: string;
  prompt: string;
  runOptions: { maxRounds: number; depth: number };
  historicalSteps: ForkHistoricalStep[];
};

export type GcResult = {
  scannedThreads: number;
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
