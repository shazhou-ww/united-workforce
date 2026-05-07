/** Normalize `refs` from persisted JSONL or IPC payloads (missing or invalid → []). */
export function normalizeRefsField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const x of value) {
    if (typeof x === "string") {
      out.push(x);
    }
  }
  return out;
}
