import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { err, garbageCollectCas, ok, type Result } from "@uncaged/workflow";

import { resolveThreadDataPath } from "../../thread-scan.js";

export async function cmdThreadRemove(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }

  const dir = dirname(dataPath);
  const infoPath = join(dir, `${threadId}.info.jsonl`);
  const runningPath = join(dir, `${threadId}.running`);

  await unlink(dataPath);
  await unlink(infoPath).catch(() => {});
  await unlink(runningPath).catch(() => {});

  await garbageCollectCas(storageRoot);

  return ok(undefined);
}
