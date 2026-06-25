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
 * Default per-event watchdog window. 45s = 3× the Sumeru server-side
 * `sseHeartbeatMs` default of 15s — survives one missed heartbeat with
 * headroom.
 *
 * NOTE: there is deliberately NO wall-clock "total" timeout. How long an
 * agent may run is decided solely by sumeru's `sendTimeoutMs` (single source
 * of truth); the broker only guards against a *dead connection* via this
 * per-event heartbeat watchdog. See sumeru#105 / #439.
 */
export const DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * Optional construction options for `createSumeruClient`. The knob accepts
 * `T | null` (per the project convention forbidding optional `?:` fields):
 * `null` (or omitted) means "use the default".
 */
export type SumeruClientOptions = Readonly<{
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
 * Payload value of the RFC #95 `suspend` SSE event — a fourth terminal event
 * (parallel to `done`/`error`) emitted by Sumeru on a send timeout (issue
 * #435, Phase 2). `nativeId` identifies the Sumeru-native session for a future
 * `--resume`; the broker maps it through `(threadId, role)`.
 */
export type SumeruSuspendValue = Readonly<{
  reason: "timeout";
  nativeId: string;
  elapsedMs: number;
}>;

/**
 * Outcome of consuming one SSE response — a discriminated union on `kind`
 * (issue #435, Phase 2):
 *
 * - `completed` — the stream ended in `done`. Carries the last assistant
 *   turn's content, the assistant-turn count/list, and the per-exchange `done`
 *   summary.
 * - `suspended` — the stream ended in `suspend` (a send timeout). Carries the
 *   `SumeruSuspendValue` and the assistant turns observed before the timeout.
 *   It has NO `done`/`output`/`assistantTurnCount` — accessing them is a
 *   compile error unless the caller first narrows `kind === "completed"`. This
 *   makes "suspended ⇒ no done" hold at the type level.
 */
export type SumeruSendOutcome =
  | Readonly<{
      kind: "completed";
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
    }>
  | Readonly<{
      kind: "suspended";
      /**
       * Assistant turns observed before the timeout, in arrival order. May be
       * empty. Phase 3 deepens retention semantics; this Phase at least does
       * not drop already-collected turns.
       */
      assistantTurns: readonly SumeruTurnValue[];
      /** The `suspend` event payload (`reason`/`nativeId`/`elapsedMs`). */
      suspend: SumeruSuspendValue;
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
