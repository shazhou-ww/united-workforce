import type { JSONSchema } from "@ocas/core";

import type { EvalRunConfig, EvalStore } from "../storage/index.js";
import type { JudgeEntry, TaskManifest } from "../task/index.js";

/** Result of the prepare phase: task dir, temp working dir, parsed manifest. */
export type PrepareResult = {
  taskDir: string;
  workDir: string;
  manifest: TaskManifest;
};

/** Input to the execute phase. */
export type ExecuteInput = {
  /** Working directory the workflow runs in (the prepared temp dir). */
  workDir: string;
  /** Workflow name or path (from task.yaml). */
  workflow: string;
  /** Initial prompt for the thread. */
  prompt: string;
  /** Agent adapter to use. */
  agent: string;
  /** Maximum number of steps to execute. */
  maxSteps: number;
};

/** Result of the execute phase. */
export type ExecuteResult = {
  threadId: string;
};

/** Output produced by running a single judge. */
export type JudgeRunOutput = {
  score: number;
  data: unknown;
  /** Schema describing `data`, used when persisting to CAS. */
  schema: JSONSchema;
};

/** Pluggable judge execution strategy (injectable for testing). */
export type JudgeRunner = (
  taskDir: string,
  workDir: string,
  threadId: string,
  judge: JudgeEntry,
) => Promise<JudgeRunOutput>;

/** Input to the collect phase. */
export type CollectInput = {
  evalStore: EvalStore;
  taskDir: string;
  workDir: string;
  threadId: string;
  manifest: TaskManifest;
  config: EvalRunConfig;
};

/** A single judge's summarized result in the run output. */
export type JudgeSummary = {
  name: string;
  score: number;
  weight: number;
};

/** Result of the collect phase. */
export type CollectResult = {
  runHash: string;
  overall: number;
  judges: JudgeSummary[];
};

/** Options for a full eval run (from CLI flags). */
export type RunOptions = {
  agent: string;
  model: string;
  count: number;
};

/** Final result of a full eval run. */
export type RunResult = {
  runHash: string;
  overall: number;
  task: string;
  judges: JudgeSummary[];
};
