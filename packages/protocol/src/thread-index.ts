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
  const status = rec.status;
  const completedAt = rec.completedAt;
  return {
    head: head as CasRef,
    suspendedRole: typeof suspendedRole === "string" ? suspendedRole : null,
    suspendMessage: typeof suspendMessage === "string" ? suspendMessage : null,
    status: typeof status === "string" ? (status as "idle" | "running" | "suspended" | "completed" | "cancelled") : "idle",
    completedAt: typeof completedAt === "number" ? completedAt : null,
  };
}

export function createThreadIndexEntry(head: CasRef): ThreadIndexEntry {
  return {
    head,
    suspendedRole: null,
    suspendMessage: null,
    status: "idle",
    completedAt: null,
  };
}

export function updateThreadHead(_entry: ThreadIndexEntry, head: CasRef): ThreadIndexEntry {
  return {
    head,
    suspendedRole: null,
    suspendMessage: null,
    status: "idle",
    completedAt: null,
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
    status: "suspended",
    completedAt: null,
  };
}

export function markThreadCompleted(
  entry: ThreadIndexEntry,
  status: "completed" | "cancelled",
  now: number,
): ThreadIndexEntry {
  return {
    head: entry.head,
    suspendedRole: null,
    suspendMessage: null,
    status,
    completedAt: now,
  };
}

/** Serialize for variable store — compact string when not suspended. */
export function serializeThreadIndexEntry(
  entry: ThreadIndexEntry,
): string | Record<string, string | number> {
  // Compact string only for idle status with no suspend metadata
  if (entry.status === "idle" && entry.suspendedRole === null && entry.suspendMessage === null && entry.completedAt === null) {
    return entry.head;
  }

  // Build object representation
  const obj: Record<string, string | number> = {
    head: entry.head,
  };

  // Include suspend metadata if present
  if (entry.suspendedRole !== null) {
    obj.suspendedRole = entry.suspendedRole;
  }
  if (entry.suspendMessage !== null) {
    obj.suspendMessage = entry.suspendMessage;
  }

  // Always include status if not idle
  if (entry.status !== "idle") {
    obj.status = entry.status;
  }

  // Include completedAt if present
  if (entry.completedAt !== null) {
    obj.completedAt = entry.completedAt;
  }

  return obj;
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
): Record<string, string | Record<string, string | number>> {
  const out: Record<string, string | Record<string, string | number>> = {};
  for (const [threadId, entry] of Object.entries(index)) {
    out[threadId] = serializeThreadIndexEntry(entry);
  }
  return out;
}
