import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CasRef, ThreadId, ThreadIndexEntry } from "@united-workforce/protocol";
import { createThreadIndexEntry } from "@united-workforce/protocol";
import { createUwfStore, setThread, type UwfStore } from "../store.js";

/**
 * Create an isolated UwfStore backed by a tmpdir.
 * Sets process.env.OCAS_HOME so CAS resolves to the test's directory.
 * Callers MUST save/restore OCAS_HOME in afterEach.
 */
export async function makeUwfStore(storageRoot: string): Promise<UwfStore> {
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  process.env.OCAS_HOME = casDir;
  return createUwfStore(storageRoot);
}

async function ensureHeadInCas(
  uwf: Awaited<ReturnType<typeof createUwfStore>>,
  head: CasRef,
  threadId: ThreadId,
): Promise<CasRef> {
  if (uwf.store.cas.get(head) !== null) {
    return head;
  }
  return (await uwf.store.cas.put(uwf.schemas.text, `thread-head:${threadId}:${head}`)) as CasRef;
}

export async function seedThread(
  storageRoot: string,
  threadId: ThreadId,
  entry: ThreadIndexEntry | CasRef,
): Promise<void> {
  const uwf = await createUwfStore(storageRoot);
  const normalized = typeof entry === "string" ? createThreadIndexEntry(entry) : entry;
  const head = await ensureHeadInCas(uwf, normalized.head, threadId);
  setThread(uwf.varStore, threadId, { ...normalized, head });
}

export async function seedThreads(
  storageRoot: string,
  entries: Record<ThreadId, ThreadIndexEntry | CasRef>,
): Promise<void> {
  const uwf = await createUwfStore(storageRoot);
  for (const [threadId, entry] of Object.entries(entries)) {
    const normalized = typeof entry === "string" ? createThreadIndexEntry(entry as CasRef) : entry;
    const head = await ensureHeadInCas(uwf, normalized.head, threadId as ThreadId);
    setThread(uwf.varStore, threadId as ThreadId, { ...normalized, head });
  }
}
