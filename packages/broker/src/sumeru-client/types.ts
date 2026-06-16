/**
 * Public types for `sumeru-client` — the Sumeru HTTP client used by
 * `broker.send()` to talk to a Sumeru instance over the gateway API.
 *
 * Per CLAUDE.md `Folder Module Discipline`, type definitions live in
 * `types.ts` so other files can import them without pulling in
 * implementation.
 */

/** Error code thrown when Sumeru reports a missing session at message time. */
export const SUMERU_SESSION_NOT_FOUND = "sumeru_session_not_found";

/**
 * Default wall-clock cap for one `sendMessage` SSE consumption. Five minutes
 * is long enough for slow ReAct loops but short enough that a stuck thread
 * fails within reasonable wall time.
 */
export const DEFAULT_SSE_TOTAL_TIMEOUT_MS = 300_000;

/**
 * Default per-event watchdog window. 45s = 3× the Sumeru server-side
 * `sseHeartbeatMs` default of 15s — survives one missed heartbeat with
 * headroom.
 */
export const DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * Optional construction options for `createSumeruClient`. Both knobs accept
 * `T | null` (per the project convention forbidding optional `?:` fields):
 * `null` (or omitted) means "use the default".
 */
export type SumeruClientOptions = Readonly<{
  /** Wall-clock cap on one sendMessage SSE consumption. Defaults to 300_000ms. */
  sseTotalTimeoutMs: number | null;
  /** Per-event watchdog window. Defaults to 45_000ms (3x server heartbeat). */
  sseHeartbeatTimeoutMs: number | null;
}>;

/**
 * Shape of a `value` field inside a Sumeru `turn` SSE event.
 *
 * Mirrors `@sumeru/core`'s `Turn` type but only requires the fields the
 * broker consumes (`role`, `content`). Other fields are kept loose so
 * server-side schema additions don't break the client.
 */
export type SumeruTurnValue = Readonly<{
  index: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: unknown;
  tokens: { input: number; output: number } | null;
  hash: string | null;
}>;

/**
 * Payload value of the `done` SSE event — what callers need to build
 * `Usage` summaries.
 */
export type SumeruDoneValue = Readonly<{
  turnCount: number;
  tokens: { in: number; out: number } | null;
  durationMs: number;
}>;

/**
 * Outcome of consuming one SSE response — the last assistant turn's content,
 * the count of assistant turns observed, and the per-exchange `done` summary.
 */
export type SumeruSendOutcome = Readonly<{
  /** Raw content of the last assistant turn — verbatim, no trimming. */
  output: string;
  /** Number of assistant turns observed in this exchange. */
  assistantTurnCount: number;
  /**
   * Every assistant turn observed in this exchange, in arrival order
   * (issue #397, Phase 1). `output` is the last entry's `content`.
   */
  assistantTurns: readonly SumeruTurnValue[];
  /** Summary delivered by the final `done` event. */
  done: SumeruDoneValue;
}>;

/** Arguments for `client.createSession`. */
export type CreateSessionArgs = Readonly<{
  gateway: string;
  /** Optional workspace root to bind the session to (Sumeru #27). */
  cwd: string | null;
}>;

/** Arguments for `client.sendMessage`. */
export type SendMessageArgs = Readonly<{
  gateway: string;
  sessionId: string;
  content: string;
}>;

/**
 * Realtime per-assistant-turn listener for `client.sendMessage` (issue #397,
 * Phase 1). Invoked synchronously inside the SSE reader loop, once per applied
 * assistant turn, in arrival order — before `sendMessage` resolves. The
 * argument is the raw `SumeruTurnValue`; the broker projects it to a
 * `BrokerTurn`. Non-assistant turns never fire it.
 */
export type SumeruTurnListener = (turn: SumeruTurnValue) => void;

/**
 * Stateless Sumeru HTTP client. Each method does its own `fetch` against the
 * configured `host`. The factory does not perform I/O at construction time.
 */
export type SumeruClient = Readonly<{
  /** POST `/gateways/:gw/sessions`, return the new session id. */
  createSession: (args: CreateSessionArgs) => Promise<string>;
  /**
   * POST `/gateways/:gw/sessions/:id/messages`, consume SSE, return outcome.
   * `onAssistantTurn` (issue #397) fires synchronously per assistant turn as
   * the stream is read; omit it (or pass `undefined`) for the pre-Phase-1
   * behavior.
   */
  sendMessage: (
    args: SendMessageArgs,
    onAssistantTurn?: SumeruTurnListener,
  ) => Promise<SumeruSendOutcome>;
}>;
