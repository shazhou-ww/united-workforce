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
 * Stateless Sumeru HTTP client. Each method does its own `fetch` against the
 * configured `host`. The factory does not perform I/O at construction time.
 */
export type SumeruClient = Readonly<{
  /** POST `/gateways/:gw/sessions`, return the new session id. */
  createSession: (args: CreateSessionArgs) => Promise<string>;
  /** POST `/gateways/:gw/sessions/:id/messages`, consume SSE, return outcome. */
  sendMessage: (args: SendMessageArgs) => Promise<SumeruSendOutcome>;
}>;
