/**
 * Sumeru HTTP client — session creation + SSE message stream.
 *
 * Uses the global `fetch` available in Node 18+. The client maintains no
 * connection pool because `uwf thread exec` invocations are short-lived.
 *
 * The factory `createSumeruClient(host, options?)` returns a frozen object
 * exposing only the methods needed by `broker.send()`. `host` is normalised
 * at construction time (trailing slash stripped) so subsequent path joins
 * never produce `//gateways/...`. `options` plumbs the SSE total-timeout
 * and per-event watchdog windows used to bound `consumeSse` (see
 * issue #391).
 */

import { SumeruSessionNotFoundError } from "./errors.js";
import { createSseParser, type SseEvent } from "./sse.js";
import {
  type CreateSessionArgs,
  DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_SSE_TOTAL_TIMEOUT_MS,
  type SendMessageArgs,
  type SumeruClient,
  type SumeruClientOptions,
  type SumeruDoneValue,
  type SumeruSendOutcome,
  type SumeruTurnListener,
  type SumeruTurnValue,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractSumeruErrorCode(body: unknown): string | null {
  if (isRecord(body) && body.type === "@sumeru/error" && isRecord(body.value)) {
    const code = body.value.error;
    if (typeof code === "string") return code;
  }
  return null;
}

function extractSumeruErrorMessage(body: unknown): string | null {
  if (isRecord(body) && body.type === "@sumeru/error" && isRecord(body.value)) {
    const message = body.value.message;
    if (typeof message === "string") return message;
  }
  return null;
}

function buildSessionErrorMessage(
  status: number,
  host: string,
  gateway: string,
  body: unknown,
): string {
  const code = extractSumeruErrorCode(body);
  const detail = extractSumeruErrorMessage(body);
  const codeText = code !== null ? ` ${code}` : "";
  const detailText = detail !== null ? `: ${detail}` : "";
  return `sumeru session create failed (HTTP ${status}${codeText}) — gateway=${gateway} instance=${host}${detailText}`;
}

function buildMessageErrorMessage(
  status: number,
  host: string,
  gateway: string,
  sessionId: string,
  body: unknown,
): string {
  const code = extractSumeruErrorCode(body);
  const detail = extractSumeruErrorMessage(body);
  const codeText = code !== null ? ` ${code}` : "";
  const detailText = detail !== null ? `: ${detail}` : "";
  return `sumeru message send failed (HTTP ${status}${codeText}) — gateway=${gateway} session=${sessionId} instance=${host}${detailText}`;
}

/**
 * Create a stateless Sumeru HTTP client bound to `host`.
 *
 * - Trailing slashes on `host` are normalised.
 * - No I/O at construction time.
 * - The returned object is frozen and exposes exactly two methods:
 *   `createSession` and `sendMessage`.
 * - `options` (issue #391):
 *   - `sseTotalTimeoutMs` — wall-clock cap on one `sendMessage` SSE
 *     consumption. Default 300_000ms. `null` (or absent) means default.
 *   - `sseHeartbeatTimeoutMs` — per-event watchdog window. Default
 *     45_000ms (3× server heartbeat). `null` (or absent) means default.
 *   `undefined`, `{}`, and `{ sseTotalTimeoutMs: null, sseHeartbeatTimeoutMs: null }`
 *   are all treated identically.
 */
export function createSumeruClient(host: string, options?: SumeruClientOptions): SumeruClient {
  const normalisedHost = host.replace(/\/+$/, "");
  const sseTotalTimeoutMs =
    options !== undefined && options.sseTotalTimeoutMs !== null
      ? options.sseTotalTimeoutMs
      : DEFAULT_SSE_TOTAL_TIMEOUT_MS;
  const sseHeartbeatTimeoutMs =
    options !== undefined && options.sseHeartbeatTimeoutMs !== null
      ? options.sseHeartbeatTimeoutMs
      : DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS;

  async function createSession(args: CreateSessionArgs): Promise<string> {
    const url = joinUrl(normalisedHost, `/gateways/${args.gateway}/sessions`);
    const requestBody = args.cwd === null ? "{}" : JSON.stringify({ workspaceRoot: args.cwd });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: requestBody,
    });

    const body = await readJsonBody(response);

    if (!response.ok) {
      throw new Error(
        buildSessionErrorMessage(response.status, normalisedHost, args.gateway, body),
      );
    }

    if (
      !isRecord(body) ||
      body.type !== "@sumeru/session" ||
      !isRecord(body.value) ||
      typeof body.value.id !== "string" ||
      body.value.id === ""
    ) {
      throw new Error(
        `sumeru session create returned unexpected body (status=${response.status}, gateway=${args.gateway}, instance=${normalisedHost})`,
      );
    }

    return body.value.id;
  }

  async function sendMessage(
    args: SendMessageArgs,
    onAssistantTurn?: SumeruTurnListener,
  ): Promise<SumeruSendOutcome> {
    const url = joinUrl(
      normalisedHost,
      `/gateways/${args.gateway}/sessions/${args.sessionId}/messages`,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ content: args.content }),
    });

    if (!response.ok) {
      const body = await readJsonBody(response);
      const code = extractSumeruErrorCode(body);
      if (response.status === 404 && code === "session_not_found") {
        throw new SumeruSessionNotFoundError(args.gateway, args.sessionId);
      }
      throw new Error(
        buildMessageErrorMessage(
          response.status,
          normalisedHost,
          args.gateway,
          args.sessionId,
          body,
        ),
      );
    }

    if (response.body === null) {
      throw new Error(
        `sumeru SSE response has no body (gateway=${args.gateway}, session=${args.sessionId})`,
      );
    }

    return consumeSse({
      body: response.body,
      gateway: args.gateway,
      sessionId: args.sessionId,
      sseTotalTimeoutMs,
      sseHeartbeatTimeoutMs,
      onAssistantTurn: onAssistantTurn ?? null,
    });
  }

  return Object.freeze({ createSession, sendMessage });
}

/** Mutable accumulator for SSE consumption — owned by `consumeSse`. */
type SseState = {
  assistantTurns: SumeruTurnValue[];
  totalTurns: number;
  done: SumeruDoneValue | null;
  errorMessage: string | null;
  /** Realtime per-assistant-turn listener (issue #397); `null` ⇒ no callback. */
  onAssistantTurn: SumeruTurnListener | null;
};

function applyOutcome(state: SseState, outcome: EventOutcome): void {
  if (outcome.errorMessage !== null) state.errorMessage = outcome.errorMessage;
  if (outcome.assistantTurn !== null) {
    state.assistantTurns.push(outcome.assistantTurn);
    // Fire synchronously, in arrival order, BEFORE the stream is drained —
    // this is the realtime guarantee. Assistant-turn-scoped: non-assistant
    // turns produce a null `assistantTurn` and never reach here.
    if (state.onAssistantTurn !== null) state.onAssistantTurn(outcome.assistantTurn);
  }
  if (outcome.anyTurn) state.totalTurns += 1;
  if (outcome.done !== null) state.done = outcome.done;
}

function isStreamFinished(state: SseState): boolean {
  return state.errorMessage !== null || state.done !== null;
}

function processEvents(events: Iterable<SseEvent>, state: SseState): void {
  for (const evt of events) {
    applyOutcome(state, handleEvent(evt));
    if (isStreamFinished(state)) return;
  }
}

type ReadResult = { done: boolean; value: Uint8Array | undefined };

async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  parser: ReturnType<typeof createSseParser>,
  state: SseState,
  abortPromise: Promise<never>,
  resetWatchdog: () => void,
): Promise<void> {
  while (true) {
    // Swallow late rejection from a read() that loses the race against the
    // abort timer — `reader.cancel()` (called in the finally block) will
    // resolve/reject the promise after we've already thrown the timeout/
    // watchdog error, and we don't want that to surface as unhandled.
    const readPromise: Promise<ReadResult> = reader
      .read()
      .then((r) => ({ done: r.done, value: r.value }))
      .catch((): ReadResult => ({ done: true, value: undefined }));
    const next = (await Promise.race([readPromise, abortPromise])) as ReadResult;
    if (next.done) return;
    const chunk = decoder.decode(next.value, { stream: true });
    const events = parser.push(chunk);
    let consumedAny = false;
    for (const evt of events) {
      consumedAny = true;
      applyOutcome(state, handleEvent(evt));
      if (isStreamFinished(state)) {
        if (consumedAny) resetWatchdog();
        return;
      }
    }
    if (consumedAny) resetWatchdog();
  }
}

function finalizeOutcome(state: SseState): SumeruSendOutcome {
  if (state.errorMessage !== null) {
    throw new Error(state.errorMessage);
  }
  if (state.done === null) {
    throw new Error(
      `sumeru SSE stream ended after ${state.totalTurns} turn events without done or error`,
    );
  }
  const last = state.assistantTurns[state.assistantTurns.length - 1];
  if (last === undefined) {
    throw new Error("sumeru SSE stream produced no assistant turns");
  }
  return {
    output: last.content,
    assistantTurnCount: state.assistantTurns.length,
    assistantTurns: state.assistantTurns,
    done: state.done,
  };
}

type ConsumeSseArgs = Readonly<{
  body: ReadableStream<Uint8Array>;
  gateway: string;
  sessionId: string;
  sseTotalTimeoutMs: number;
  sseHeartbeatTimeoutMs: number;
  onAssistantTurn: SumeruTurnListener | null;
}>;

type AbortKind = "total" | "watchdog";

async function consumeSse(args: ConsumeSseArgs): Promise<SumeruSendOutcome> {
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const reader = args.body.getReader();
  const state: SseState = {
    assistantTurns: [],
    totalTurns: 0,
    done: null,
    errorMessage: null,
    onAssistantTurn: args.onAssistantTurn,
  };

  let totalTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let abortReason: AbortKind | null = null;
  let abortReject: ((err: Error) => void) | null = null;

  const totalErrorMessage = `sumeru SSE stream timed out after ${args.sseTotalTimeoutMs}ms (gateway=${args.gateway}, session=${args.sessionId})`;
  const watchdogErrorMessage = `sumeru SSE stream watchdog: no event received within ${args.sseHeartbeatTimeoutMs}ms (gateway=${args.gateway}, session=${args.sessionId})`;

  function clearTotalTimer(): void {
    if (totalTimer !== null) {
      clearTimeout(totalTimer);
      totalTimer = null;
    }
  }

  function clearWatchdogTimer(): void {
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function fireAbort(kind: AbortKind, message: string): void {
    if (abortReason !== null) return;
    abortReason = kind;
    if (abortReject !== null) abortReject(new Error(message));
  }

  function resetWatchdog(): void {
    clearWatchdogTimer();
    watchdogTimer = setTimeout(() => {
      fireAbort("watchdog", watchdogErrorMessage);
    }, args.sseHeartbeatTimeoutMs);
  }

  totalTimer = setTimeout(() => {
    fireAbort("total", totalErrorMessage);
  }, args.sseTotalTimeoutMs);
  resetWatchdog();

  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortReject = reject;
  });
  // The abort promise may reject after `Promise.race` has already returned
  // (e.g. when the watchdog fires concurrently with a successful drain).
  // Attach a swallow-handler so the dangling rejection does NOT surface as
  // an unhandled promise rejection.
  abortPromise.catch(() => undefined);

  try {
    await readSseStream(reader, decoder, parser, state, abortPromise, resetWatchdog);
    // Drain trailing partial frame (if any) and pull final residual decode bytes.
    const tail = decoder.decode();
    if (tail !== "") {
      processEvents(parser.push(tail), state);
    }
    processEvents(parser.drain(), state);
  } finally {
    clearTotalTimer();
    clearWatchdogTimer();
    try {
      await reader.cancel(abortReason === null ? undefined : abortReason);
    } catch {
      // ignore — partial reads must not leak the underlying socket
    }
  }

  return finalizeOutcome(state);
}

type EventOutcome = {
  assistantTurn: SumeruTurnValue | null;
  anyTurn: boolean;
  done: SumeruDoneValue | null;
  errorMessage: string | null;
};

function handleEvent(evt: SseEvent): EventOutcome {
  const empty: EventOutcome = {
    assistantTurn: null,
    anyTurn: false,
    done: null,
    errorMessage: null,
  };
  switch (evt.event) {
    case "turn":
      return parseTurnEvent(evt.data, empty);
    case "done":
      return parseDoneEvent(evt.data, empty);
    case "error":
      return parseErrorEvent(evt.data, empty);
    case "heartbeat":
      return empty;
    default:
      return empty;
  }
}

function parseTurnEvent(data: string, base: EventOutcome): EventOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {
      ...base,
      errorMessage: `sumeru SSE turn event has malformed JSON: ${data.slice(0, 200)}`,
    };
  }
  if (!isRecord(parsed) || parsed.type !== "@sumeru/turn" || !isRecord(parsed.value)) {
    return base;
  }
  const value = parsed.value;
  if (typeof value.role !== "string" || typeof value.content !== "string") {
    return {
      ...base,
      errorMessage: "sumeru SSE turn event missing role or content",
    };
  }
  const turn: SumeruTurnValue = {
    index: typeof value.index === "number" ? value.index : -1,
    role: value.role as SumeruTurnValue["role"],
    content: value.content,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : "",
    toolCalls: value.toolCalls,
    tokens:
      isRecord(value.tokens) &&
      typeof value.tokens.input === "number" &&
      typeof value.tokens.output === "number"
        ? { input: value.tokens.input, output: value.tokens.output }
        : null,
    hash: typeof value.hash === "string" ? value.hash : null,
  };
  return {
    ...base,
    assistantTurn: turn.role === "assistant" ? turn : null,
    anyTurn: true,
  };
}

function parseDoneEvent(data: string, base: EventOutcome): EventOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {
      ...base,
      errorMessage: `sumeru SSE done event has malformed JSON: ${data.slice(0, 200)}`,
    };
  }
  if (!isRecord(parsed) || parsed.type !== "@sumeru/summary" || !isRecord(parsed.value)) {
    return {
      ...base,
      errorMessage: "sumeru SSE done event missing @sumeru/summary envelope",
    };
  }
  const value = parsed.value;
  const turnCount = typeof value.turnCount === "number" ? value.turnCount : 0;
  const durationMs = typeof value.durationMs === "number" ? value.durationMs : 0;
  const tokens =
    isRecord(value.tokens) &&
    typeof value.tokens.in === "number" &&
    typeof value.tokens.out === "number"
      ? { in: value.tokens.in, out: value.tokens.out }
      : null;
  return {
    ...base,
    done: { turnCount, durationMs, tokens },
  };
}

function parseErrorEvent(data: string, base: EventOutcome): EventOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {
      ...base,
      errorMessage: `sumeru SSE error event has malformed JSON: ${data.slice(0, 200)}`,
    };
  }
  if (!isRecord(parsed) || parsed.type !== "@sumeru/error" || !isRecord(parsed.value)) {
    return {
      ...base,
      errorMessage: "sumeru SSE error event missing @sumeru/error envelope",
    };
  }
  const code = typeof parsed.value.error === "string" ? parsed.value.error : "unknown";
  const message = typeof parsed.value.message === "string" ? parsed.value.message : "";
  return {
    ...base,
    errorMessage: message === "" ? `sumeru ${code}` : `sumeru ${code}: ${message}`,
  };
}
