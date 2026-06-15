import type { RoleName, ThreadId } from "@united-workforce/protocol";

export type SessionInput = Readonly<{
  threadId: ThreadId;
  role: RoleName;
  host: string;
  gateway: string;
  sessionId: string;
}>;

export type SessionRecord = Readonly<{
  threadId: ThreadId;
  role: RoleName;
  host: string;
  gateway: string;
  sessionId: string;
  createdAt: number;
}>;

export type SessionStore = Readonly<{
  upsertSession: (input: SessionInput) => SessionRecord;
  getSession: (threadId: ThreadId, role: RoleName) => SessionRecord | null;
  listByThread: (threadId: ThreadId) => readonly SessionRecord[];
  deleteByThread: (threadId: ThreadId) => number;
  close: () => void;
}>;

export type CreateSessionStoreOptions = Readonly<{
  dbPath: string | null;
}>;
