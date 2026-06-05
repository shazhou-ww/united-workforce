/** Output shape every judge must produce on stdout (JSON). */
export type JudgeOutput<T = unknown> = {
  /** Score between 0.0 and 1.0. */
  score: number;
  /** Judge-specific structured data, stored in CAS with its own schema. */
  data: T;
};

/** Input context passed to judge scripts via argv. */
export type JudgeInput = {
  /** Working directory where the task was executed. */
  cwd: string;
  /** Thread ID of the eval run. */
  threadId: string;
};
