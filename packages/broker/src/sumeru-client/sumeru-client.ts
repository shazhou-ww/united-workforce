/**
 * Sumeru HTTP client — session creation + SSE message stream.
 *
 * Uses the global `fetch` available in Node 18+. The client maintains no
 * connection pool because `uwf thread exec` invocations are short-lived.
 *
 * The factory `createSumeruClient(host)` returns a frozen object exposing
 * only the methods needed by `broker.send()`. `host` is normalised at
 * construction time (trailing slash stripped) so subsequent path joins
 * never produce `//gateways/...`.
 */

import { SumeruSessionNotFoundError } from "./errors.js";
import { createSseParser, type SseEvent } from "./sse.js";
import type {
  CreateSessionArgs,
  SendMessageArgs,
  SumeruClient,
  SumeruDoneValue,
  SumeruSendOutcome,
  SumeruTurnValue,
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
 */
export function createSumeruClient(host: string): SumeruClient {
  const normalisedHost = host.replace(/\/+$/, "");

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

  async function sendMessage(args: SendMessageArgs): Promise<SumeruSendOutcome> {
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

    return consumeSse(response.body);
  }

  return Object.freeze({ createSession, sendMessage });
}

/** Mutable accumulator for SSE consumption — owned by `consumeSse`. */
type SseState = {
  assistantTurns: SumeruTurnValue[];
  totalTurns: number;
  done: SumeruDoneValue | null;
  errorMessage: string | null;
};

function applyOutcome(state: SseState, outcome: EventOutcome): void {
  if (outcome.errorMessage !== null) state.errorMessage = outcome.errorMessage;
  if (outcome.assistantTurn !== null) state.assistantTurns.push(outcome.assistantTurn);
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

async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  parser: ReturnType<typeof createSseParser>,
  state: SseState,
): Promise<void> {
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) return;
    const chunk = decoder.decode(value, { stream: true });
    processEvents(parser.push(chunk), state);
    if (isStreamFinished(state)) return;
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
    done: state.done,
  };
}

async function consumeSse(body: ReadableStream<Uint8Array>): Promise<SumeruSendOutcome> {
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const reader = body.getReader();
  const state: SseState = {
    assistantTurns: [],
    totalTurns: 0,
    done: null,
    errorMessage: null,
  };

  try {
    await readSseStream(reader, decoder, parser, state);
    // Drain trailing partial frame (if any) and pull final residual decode bytes.
    const tail = decoder.decode();
    if (tail !== "") {
      processEvents(parser.push(tail), state);
    }
    processEvents(parser.drain(), state);
  } finally {
    try {
      await reader.cancel();
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
