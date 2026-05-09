import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  garbageCollectCas,
  removeThreadEntry,
  removeThreadHistoryEntries,
} from "@uncaged/workflow-execute";
import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { resolveThreadRecord } from "../../thread-scan.js";

export async function cmdThreadRemove(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  const resolved = await resolveThreadRecord(storageRoot, threadId);
  if (resolved === null) {
    return err(`thread not found: ${threadId}`);
  }

  if (resolved.source === "active") {
    await removeThreadEntry(resolved.bundleDir, threadId);
  } else {
    const hist = await removeThreadHistoryEntries(resolved.bundleDir, threadId);
    if (!hist.ok) {
      return hist;
    }
  }

  const infoPath = join(storageRoot, "logs", resolved.bundleHash, `${threadId}.info.jsonl`);
  const runningPath = join(storageRoot, "logs", resolved.bundleHash, `${threadId}.running`);

  await unlink(infoPath).catch(() => {});
  await unlink(runningPath).catch(() => {});

  await garbageCollectCas(storageRoot);

  return ok(undefined);
}
