export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Moderator routes the thread to a real role (or `$END`). */
export type EvaluateRouteResult = {
  role: string;
  prompt: string;
  /** Resolved working directory from edge location field (null = inherit thread cwd). */
  location: string | null;
};

/** Moderator routes the thread to `$SUSPEND` — waiting for external input. */
export type EvaluateSuspendResult = {
  action: "suspend";
  /** Role whose output triggered the suspend transition. */
  suspendedRole: string;
  prompt: string;
};

/** The result of moderator evaluation. */
export type EvaluateResult = EvaluateRouteResult | EvaluateSuspendResult;

export function isSuspendResult(result: EvaluateResult): result is EvaluateSuspendResult {
  return "action" in result && result.action === "suspend";
}
