import { createCasStore, getGlobalCasDir, ok, type Result } from "@uncaged/workflow";

export async function cmdCasRm(storageRoot: string, hash: string): Promise<Result<void, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  await cas.delete(hash);
  return ok(undefined);
}
