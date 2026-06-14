/**
 * Public types for `@united-workforce/agent-sumeru`.
 *
 * Per CLAUDE.md `Folder Module Discipline`, every folder's type definitions
 * live in `types.ts` so other files can import from `./types.js` without
 * pulling in implementation.
 */

/** Result type used by pure helpers that can fail without throwing. */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

/**
 * A single Sumeru instance the adapter can talk to. URL is stored without a
 * trailing slash; the adapter joins paths with `/`.
 */
export type SumeruInstance = {
  url: string;
};

/**
 * In-memory shape of `<UWF_HOME>/agents/sumeru.yaml`.
 *
 * `instances` is the map keyed by the human-readable instance name.
 * `defaultInstanceName` is the name selected by the `default: true` marker,
 * or the only-instance fallback when N=1.
 * `defaultGateway` is the Sumeru gateway name used for every request in
 * Phase 1.
 */
export type SumeruConfig = {
  instances: Record<string, SumeruInstance>;
  defaultInstanceName: string;
  defaultGateway: string;
};

/**
 * Shape of a `value` field inside a Sumeru `turn` SSE event.
 *
 * Mirrors `@sumeru/core`'s `Turn` type but only requires the fields the
 * adapter consumes (`role`, `content`). Other fields are kept as `unknown`
 * so server-side schema additions don't break the adapter.
 */
export type SumeruTurnValue = {
  index: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: unknown;
  tokens: { input: number; output: number } | null | undefined;
  hash: string | null | undefined;
};

/**
 * Payload value of the `done` SSE event — what the adapter needs to build
 * `Usage`.
 */
export type SumeruDoneValue = {
  turnCount: number;
  tokens: { in: number; out: number } | null;
  durationMs: number;
};

/**
 * Outcome of consuming one SSE response — the last assistant turn's content
 * and the per-exchange `done` summary.
 */
export type SumeruSseOutcome = {
  /** Raw content of the last assistant turn — becomes the agent output. */
  output: string;
  /** Number of assistant turns observed in this exchange. */
  assistantTurnCount: number;
  /** Summary delivered by the final `done` event. */
  done: SumeruDoneValue;
};
