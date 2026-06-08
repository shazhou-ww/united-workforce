export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Moderator routes the thread to a real role (or `$END`). */
export type EvaluateRouteResult = {
  role: string;
  prompt: string;
  /** Resolved working directory from edge location field (null = inherit thread cwd). */
  location: string | null;
};

/**
 * The result of moderator evaluation. `$SUSPEND` is no longer a moderator
 * concern — it is an engine-level reserved `$status` intercepted before the
 * moderator runs.
 */
export type EvaluateResult = EvaluateRouteResult;
