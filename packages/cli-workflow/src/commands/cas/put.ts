import { createCasStore, getGlobalCasDir, ok, type Result } from "@uncaged/workflow";

export async function cmdCasPut(
  storageRoot: string,
  _threadId: string,
  content: string,
): Promise<Result<string, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const hash = await cas.put(content);
  return ok(hash);
}
