import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { bootstrap, putSchema, type Store } from "@uncaged/json-cas";

import { HERMES_DETAIL_SCHEMA, HERMES_RAW_OUTPUT_SCHEMA, HERMES_TURN_SCHEMA } from "./schemas.js";
import type {
  HermesDetailPayload,
  HermesSessionJson,
  HermesSessionMessage,
  HermesToolCall,
  HermesTurnPayload,
  HermesTurnRole,
} from "./types.js";

const SESSION_ID_LINE = /^session_id:\s*(\S+)\s*$/i;

export function getHermesSessionsDir(): string {
  return join(homedir(), ".hermes", "sessions");
}

export function getHermesSessionPath(sessionId: string): string {
  return join(getHermesSessionsDir(), `session_${sessionId}.json`);
}

/** Parse `session_id: …` from any line of Hermes stdout. */
export function parseSessionIdFromStdout(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const match = SESSION_ID_LINE.exec(line.trim());
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolCalls(raw: unknown): HermesSessionMessage["tool_calls"] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const calls: NonNullable<HermesSessionMessage["tool_calls"]> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const fn = entry.function;
    if (!isRecord(fn)) {
      continue;
    }
    const name = fn.name;
    const args = fn.arguments;
    if (typeof name !== "string" || typeof args !== "string") {
      continue;
    }
    calls.push({ function: { name, arguments: args } });
  }
  return calls.length > 0 ? calls : null;
}

function normalizeMessage(raw: unknown): HermesSessionMessage | null {
  if (!isRecord(raw)) {
    return null;
  }
  const role = raw.role;
  if (role !== "assistant" && role !== "tool" && role !== "user") {
    return null;
  }
  const content = typeof raw.content === "string" ? raw.content : raw.content === null ? null : "";
  const reasoning =
    typeof raw.reasoning === "string"
      ? raw.reasoning
      : raw.reasoning === null || raw.reasoning === undefined
        ? null
        : null;
  const tool_calls = parseToolCalls(raw.tool_calls);
  return { role, content, reasoning, tool_calls };
}

function parseSessionJson(raw: unknown): HermesSessionJson | null {
  if (!isRecord(raw)) {
    return null;
  }
  const session_id = raw.session_id;
  const model = raw.model;
  const session_start = raw.session_start;
  const messagesRaw = raw.messages;
  if (
    typeof session_id !== "string" ||
    typeof model !== "string" ||
    typeof session_start !== "string" ||
    !Array.isArray(messagesRaw)
  ) {
    return null;
  }
  const messages: HermesSessionMessage[] = [];
  for (const entry of messagesRaw) {
    const msg = normalizeMessage(entry);
    if (msg !== null) {
      messages.push(msg);
    }
  }
  return { session_id, model, session_start, messages };
}

export function getHermesDbPath(): string {
  return join(homedir(), ".hermes", "state.db");
}

type DbSessionRow = {
  id: string;
  model: string;
  started_at: number;
};

type DbMessageRow = {
  role: string;
  content: string | null;
  reasoning: string | null;
  tool_calls: string | null;
};

function parseDbToolCalls(raw: string | null): HermesSessionMessage["tool_calls"] {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseToolCalls(parsed);
  } catch {
    return null;
  }
}

function dbMessageToSessionMessage(row: DbMessageRow): HermesSessionMessage {
  return {
    role: row.role,
    content: row.content ?? null,
    reasoning: row.reasoning ?? null,
    tool_calls: parseDbToolCalls(row.tool_calls),
  };
}

export function loadHermesSessionFromDb(
  sessionId: string,
  dbPath: string | null = null,
): HermesSessionJson | null {
  const resolvedPath = dbPath ?? getHermesDbPath();
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(resolvedPath, { readonly: true });
    const session = db
      .query("SELECT id, model, started_at FROM sessions WHERE id = ?")
      .get(sessionId) as DbSessionRow | null;
    if (session === null) {
      return null;
    }
    const rows = db
      .query(
        "SELECT role, content, reasoning, tool_calls FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(sessionId) as DbMessageRow[];

    const messages: HermesSessionMessage[] = [];
    for (const row of rows) {
      const role = row.role;
      if (role !== "user" && role !== "assistant" && role !== "tool") {
        continue;
      }
      messages.push(dbMessageToSessionMessage(row));
    }

    return {
      session_id: session.id,
      model: session.model,
      session_start: new Date(session.started_at * 1000).toISOString(),
      messages,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function loadHermesSession(sessionId: string): Promise<HermesSessionJson | null> {
  const path = getHermesSessionPath(sessionId);
  try {
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text) as unknown;
    const result = parseSessionJson(raw);
    if (result !== null) {
      return result;
    }
  } catch {
    // JSON file not available, fall through to DB
  }
  return loadHermesSessionFromDb(sessionId);
}

export function computeDurationMs(sessionStart: string, nowMs: number = Date.now()): number {
  const startMs = Date.parse(sessionStart);
  if (Number.isNaN(startMs)) {
    return 0;
  }
  return Math.max(0, nowMs - startMs);
}

function mapSessionToolCalls(
  toolCalls: HermesSessionMessage["tool_calls"],
): HermesToolCall[] | null {
  if (toolCalls === null || toolCalls.length === 0) {
    return null;
  }
  return toolCalls.map((call) => ({
    name: call.function.name,
    args: call.function.arguments,
  }));
}

export function messageToTurnPayload(
  message: HermesSessionMessage,
  index: number,
): HermesTurnPayload | null {
  if (message.role !== "assistant" && message.role !== "tool") {
    return null;
  }
  const role = message.role as HermesTurnRole;
  return {
    index,
    role,
    content: message.content ?? "",
    toolCalls: mapSessionToolCalls(message.tool_calls),
    reasoning: message.reasoning,
  };
}

/** Last assistant message with non-empty text content (walks backward). */
export function extractLastAssistantContent(messages: HermesSessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg === undefined) {
      continue;
    }
    if (msg.role === "assistant" && msg.content !== null && msg.content.trim() !== "") {
      return msg.content;
    }
  }
  return "";
}

type HermesSchemaHashes = {
  turn: string;
  detail: string;
  rawOutput: string;
};

async function registerHermesSchemas(store: Store): Promise<HermesSchemaHashes> {
  await bootstrap(store);
  const [turn, detail, rawOutput] = await Promise.all([
    putSchema(store, HERMES_TURN_SCHEMA),
    putSchema(store, HERMES_DETAIL_SCHEMA),
    putSchema(store, HERMES_RAW_OUTPUT_SCHEMA),
  ]);
  return { turn, detail, rawOutput };
}

export async function storeHermesSessionDetail(
  store: Store,
  session: HermesSessionJson,
  nowMs: number = Date.now(),
): Promise<{ detailHash: string; output: string }> {
  const schemas = await registerHermesSchemas(store);
  const turnHashes: string[] = [];
  let turnIndex = 0;

  for (const message of session.messages) {
    const turn = messageToTurnPayload(message, turnIndex);
    if (turn === null) {
      continue;
    }
    const hash = await store.put(schemas.turn, turn);
    turnHashes.push(hash);
    turnIndex += 1;
  }

  const detail: HermesDetailPayload = {
    sessionId: session.session_id,
    model: session.model,
    duration: computeDurationMs(session.session_start, nowMs),
    turnCount: turnHashes.length,
    turns: turnHashes,
  };
  const detailHash = await store.put(schemas.detail, detail);
  const output = extractLastAssistantContent(session.messages);
  return { detailHash, output };
}

export async function storeHermesRawOutput(store: Store, rawOutput: string): Promise<string> {
  const schemas = await registerHermesSchemas(store);
  return store.put(schemas.rawOutput, { text: rawOutput });
}
