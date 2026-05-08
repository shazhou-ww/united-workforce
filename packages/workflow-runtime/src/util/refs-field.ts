/** Append `contentHash` to `refs` when not already present (dedupe by first occurrence order). */
export function mergeRefsWithContentHash(refs: string[], contentHash: string): string[] {
  const out = [...refs];
  if (!out.includes(contentHash)) {
    out.push(contentHash);
  }
  return out;
}
