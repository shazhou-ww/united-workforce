import { createCasStore, err, getGlobalCasDir, ok, type Result } from "@uncaged/workflow";

export async function cmdCasGet(
  storageRoot: string,
  _threadId: string,
  hash: string,
): Promise<Result<string, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const content = await cas.get(hash);
  if (content === null) {
    return err(`cas entry not found: ${hash}`);
  }
  return ok(content);
}

export async function cmdCasPut(
  storageRoot: string,
  _threadId: string,
  content: string,
): Promise<Result<string, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const hash = await cas.put(content);
  return ok(hash);
}

export async function cmdCasList(
  storageRoot: string,
  _threadId: string,
): Promise<Result<string[], string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const hashes = await cas.list();
  return ok(hashes);
}

export async function cmdCasRm(
  storageRoot: string,
  _threadId: string,
  hash: string,
): Promise<Result<void, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  await cas.delete(hash);
  return ok(undefined);
}
