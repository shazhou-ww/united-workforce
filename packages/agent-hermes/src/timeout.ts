/**
 * Resolves the effective per-prompt timeout (in milliseconds) for the
 * hermes ACP `session/prompt` call.
 *
 * Priority: `--timeout` CLI flag > `UWF_HERMES_TIMEOUT` env var > default.
 *
 * The resolver is a pure function (no side effects) so it can be unit-tested
 * by passing argv/env directly. The caller in `cli.ts` translates a
 * `{ ok: false }` result into a non-zero process exit with the error message.
 */

/** Default per-request timeout: 10 minutes (matches historic hardcoded value). */
export const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

export type ResolveTimeoutResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parse a string as a strict positive integer (no decimals, no sign, no
 * whitespace, no leading `+`). Returns null when the input is not a valid
 * positive integer.
 */
function parsePositiveInteger(s: string): number | null {
  if (!/^[0-9]+$/.test(s)) {
    return null;
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

/**
 * Resolve the hermes session/prompt timeout in milliseconds.
 *
 * Order:
 *   1. `--timeout <seconds>` on argv (must parse as positive integer)
 *   2. `UWF_HERMES_TIMEOUT=<seconds>` env (must parse as positive integer)
 *   3. `DEFAULT_PROMPT_TIMEOUT_MS`
 *
 * Empty env var (`""`) is treated as "not set" (fall through to default),
 * NOT an error.
 */
export function resolveHermesTimeoutMs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): ResolveTimeoutResult {
  const flagIdx = argv.indexOf("--timeout");
  if (flagIdx !== -1) {
    const flagValue = argv[flagIdx + 1] ?? "";
    const parsed = parsePositiveInteger(flagValue);
    if (parsed === null) {
      return {
        ok: false,
        error: `--timeout must be a positive integer (seconds); got: ${flagValue}`,
      };
    }
    return { ok: true, value: parsed * 1000 };
  }

  const envValue = env.UWF_HERMES_TIMEOUT;
  if (envValue !== undefined && envValue !== "") {
    const parsed = parsePositiveInteger(envValue);
    if (parsed === null) {
      return {
        ok: false,
        error: `UWF_HERMES_TIMEOUT must be a positive integer (seconds); got: ${envValue}`,
      };
    }
    return { ok: true, value: parsed * 1000 };
  }

  return { ok: true, value: DEFAULT_PROMPT_TIMEOUT_MS };
}

/**
 * Build the `$SUSPEND` reason text shown when the hermes prompt times out.
 *
 * Kept as a pure function so the message format is unit-testable and
 * referenced in a single location.
 */
export function formatTimeoutSuspendMessage(timeoutMs: number): string {
  const minutes = Math.round(timeoutMs / 60000);
  return `hermes prompt timed out after ${minutes} minutes`;
}
