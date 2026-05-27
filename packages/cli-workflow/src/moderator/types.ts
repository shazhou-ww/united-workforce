export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** The result of moderator evaluation — which role to go to, and the edge prompt. */
export type EvaluateResult = {
  role: string;
  prompt: string;
  /** Resolved working directory from edge location field (null = inherit thread cwd). */
  location: string | null;
};
