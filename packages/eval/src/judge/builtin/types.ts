import type { JSONSchema } from "@ocas/core";

/**
 * Output produced by a builtin judge. Structurally identical to the runner's
 * `JudgeRunOutput`; defined locally to keep the judge module free of a
 * dependency on the runner module.
 */
export type BuiltinJudgeOutput = {
  score: number;
  data: unknown;
  /** Schema describing `data`, used when persisting to CAS. */
  schema: JSONSchema;
};

/** A builtin judge analyzes a thread's steps and returns a scored result. */
export type BuiltinJudge = (threadId: string) => Promise<BuiltinJudgeOutput>;
