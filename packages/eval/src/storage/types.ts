import type { Store, VarStore } from "@ocas/core";
import type { CasRef } from "@united-workforce/protocol";

/** Handle to the OCAS store used for eval persistence. */
export type EvalStore = {
  store: Store;
  varStore: VarStore;
};

/** A single judge result within an eval run. */
export type EvalJudgeRecord = {
  name: string;
  score: number;
  weight: number;
  dataHash: CasRef;
};

/** Config snapshot for an eval run. */
export type EvalRunConfig = {
  agent: string;
  model: string;
  engineVersion: string;
};

/** Full eval run record stored in CAS. */
export type EvalRunPayload = {
  task: string;
  config: EvalRunConfig;
  threadId: string;
  judges: EvalJudgeRecord[];
  overall: number;
  timestamp: number;
};
