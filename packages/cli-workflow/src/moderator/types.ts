export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** The result of moderator evaluation — which role to go to, and the edge prompt. */
export type EvaluateResult = {
  role: string;
  prompt: string;
};
