import { createCasStore } from "@uncaged/workflow-cas";
import { ok, type Result } from "@uncaged/workflow-protocol";
import { getGlobalCasDir } from "@uncaged/workflow-util";

export async function cmdCasRm(storageRoot: string, hash: string): Promise<Result<void, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  await cas.delete(hash);
  return ok(undefined);
}
