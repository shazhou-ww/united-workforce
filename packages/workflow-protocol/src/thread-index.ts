import type { CasRef, ThreadId, ThreadIndexEntry, ThreadsIndex } from "./types.js";

/** Normalize a legacy head hash or entry object into {@link ThreadIndexEntry}. */
export function normalizeThreadIndexEntry(raw: unknown): ThreadIndexEntry | null {
  if (typeof raw === "string") {
    return createThreadIndexEntry(raw as CasRef);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const head = rec.head;
  if (typeof head !== "string") {
    return null;
  }
  const suspendedRole = rec.suspendedRole;
  const suspendMessage = rec.suspendMessage;
  return {
    head: head as CasRef,
    suspendedRole: typeof suspendedRole === "string" ? suspendedRole : null,
    suspendMessage: typeof suspendMessage === "string" ? suspendMessage : null,
  };
}

export function createThreadIndexEntry(head: CasRef): ThreadIndexEntry {
  return {
    head,
    suspendedRole: null,
    suspendMessage: null,
  };
}

export function updateThreadHead(_entry: ThreadIndexEntry, head: CasRef): ThreadIndexEntry {
  return {
    head,
    suspendedRole: null,
    suspendMessage: null,
  };
}

export function markThreadSuspended(
  entry: ThreadIndexEntry,
  suspendedRole: string,
  suspendMessage: string,
): ThreadIndexEntry {
  return {
    head: entry.head,
    suspendedRole,
    suspendMessage,
  };
}

/** Serialize for threads.yaml — compact string when not suspended. */
export function serializeThreadIndexEntry(
  entry: ThreadIndexEntry,
): string | Record<string, string> {
  if (entry.suspendedRole === null || entry.suspendMessage === null) {
    return entry.head;
  }
  return {
    head: entry.head,
    suspendedRole: entry.suspendedRole,
    suspendMessage: entry.suspendMessage,
  };
}

export function parseThreadsIndex(raw: unknown): ThreadsIndex {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const index: ThreadsIndex = {};
  for (const [threadId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = normalizeThreadIndexEntry(value);
    if (entry !== null) {
      index[threadId as ThreadId] = entry;
    }
  }
  return index;
}

export function serializeThreadsIndex(
  index: ThreadsIndex,
): Record<string, string | Record<string, string>> {
  const out: Record<string, string | Record<string, string>> = {};
  for (const [threadId, entry] of Object.entries(index)) {
    out[threadId] = serializeThreadIndexEntry(entry);
  }
  return out;
}
