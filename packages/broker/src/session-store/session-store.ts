import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { RoleName, ThreadId } from "@united-workforce/protocol";
import { createLogger, getDefaultStorageRoot } from "@united-workforce/util";

import type {
  CreateSessionStoreOptions,
  SessionInput,
  SessionRecord,
  SessionStore,
} from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

type BrokerSessionRow = {
  thread_id: string;
  role: string;
  host: string;
  gateway: string;
  session_id: string;
  created_at: number;
};

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS broker_sessions (
    thread_id   TEXT    NOT NULL,
    role        TEXT    NOT NULL,
    host        TEXT    NOT NULL,
    gateway     TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (thread_id, role)
  ) WITHOUT ROWID;
` as const;

const UPSERT_SQL = `
  INSERT INTO broker_sessions (thread_id, role, host, gateway, session_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(thread_id, role) DO UPDATE SET
    host       = excluded.host,
    gateway    = excluded.gateway,
    session_id = excluded.session_id;
` as const;

const SELECT_BY_KEY_SQL = `
  SELECT thread_id, role, host, gateway, session_id, created_at
  FROM broker_sessions
  WHERE thread_id = ? AND role = ?
  LIMIT 1;
` as const;

const SELECT_BY_THREAD_SQL = `
  SELECT thread_id, role, host, gateway, session_id, created_at
  FROM broker_sessions
  WHERE thread_id = ?
  ORDER BY role ASC;
` as const;

const DELETE_BY_THREAD_SQL = `
  DELETE FROM broker_sessions WHERE thread_id = ?;
` as const;

/** Resolve the SQLite path, defaulting to `<storageRoot>/broker/sessions.db`. */
export function resolveSessionStorePath(dbPath: string | null): string {
  if (dbPath !== null) {
    return dbPath;
  }
  return join(getDefaultStorageRoot(), "broker", "sessions.db");
}

function rowToRecord(row: BrokerSessionRow): SessionRecord {
  return {
    threadId: row.thread_id,
    role: row.role,
    host: row.host,
    gateway: row.gateway,
    sessionId: row.session_id,
    createdAt: row.created_at,
  };
}

function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  db.exec("PRAGMA user_version = 1;");
}

/**
 * Open the broker session store at `dbPath` (or the default
 * `<storageRoot>/broker/sessions.db`). The directory is created on first use
 * and the schema migration is idempotent.
 */
export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  const resolvedPath = resolveSessionStorePath(options.dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  migrate(db);
  log("BR0K3RDB", `opened broker DB at ${resolvedPath}`);

  let upsertStmt: StatementSync | null = null;
  let selectByKeyStmt: StatementSync | null = null;
  let selectByThreadStmt: StatementSync | null = null;
  let deleteByThreadStmt: StatementSync | null = null;
  let closed = false;

  function ensureUpsertStmt(): StatementSync {
    if (upsertStmt === null) {
      upsertStmt = db.prepare(UPSERT_SQL);
    }
    return upsertStmt;
  }

  function ensureSelectByKeyStmt(): StatementSync {
    if (selectByKeyStmt === null) {
      selectByKeyStmt = db.prepare(SELECT_BY_KEY_SQL);
    }
    return selectByKeyStmt;
  }

  function ensureSelectByThreadStmt(): StatementSync {
    if (selectByThreadStmt === null) {
      selectByThreadStmt = db.prepare(SELECT_BY_THREAD_SQL);
    }
    return selectByThreadStmt;
  }

  function ensureDeleteByThreadStmt(): StatementSync {
    if (deleteByThreadStmt === null) {
      deleteByThreadStmt = db.prepare(DELETE_BY_THREAD_SQL);
    }
    return deleteByThreadStmt;
  }

  function upsertSession(input: SessionInput): SessionRecord {
    const now = Date.now();
    ensureUpsertStmt().run(
      input.threadId,
      input.role,
      input.host,
      input.gateway,
      input.sessionId,
      now,
    );
    const row = ensureSelectByKeyStmt().get(input.threadId, input.role) as
      | BrokerSessionRow
      | undefined;
    if (row === undefined) {
      throw new Error(
        `broker: upsertSession failed to read row back for (${input.threadId}, ${input.role})`,
      );
    }
    return rowToRecord(row);
  }

  function getSession(threadId: ThreadId, role: RoleName): SessionRecord | null {
    const row = ensureSelectByKeyStmt().get(threadId, role) as BrokerSessionRow | undefined;
    if (row === undefined) {
      return null;
    }
    return rowToRecord(row);
  }

  function listByThread(threadId: ThreadId): readonly SessionRecord[] {
    const rows = ensureSelectByThreadStmt().all(threadId) as BrokerSessionRow[];
    return rows.map(rowToRecord);
  }

  function deleteByThread(threadId: ThreadId): number {
    const result = ensureDeleteByThreadStmt().run(threadId);
    return Number(result.changes);
  }

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    db.close();
  }

  return {
    upsertSession,
    getSession,
    listByThread,
    deleteByThread,
    close,
  };
}
