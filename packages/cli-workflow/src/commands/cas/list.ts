import { createCasStore, getGlobalCasDir, ok, type Result } from "@uncaged/workflow";

export async function cmdCasList(
  storageRoot: string,
  _threadId: string,
): Promise<Result<string[], string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const hashes = await cas.list();
  return ok(hashes);
}
