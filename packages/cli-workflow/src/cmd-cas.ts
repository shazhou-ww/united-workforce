import { dirname, join } from "node:path";

import { createThreadCas, err, ok, type Result } from "@uncaged/workflow";

import { resolveThreadDataPath } from "./thread-scan.js";

function resolveCasDir(threadDataPath: string, threadId: string): string {
  return join(dirname(threadDataPath), `${threadId}.cas`);
}

export async function cmdCasGet(
  storageRoot: string,
  threadId: string,
  hash: string,
): Promise<Result<string, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const cas = createThreadCas(resolveCasDir(dataPath, threadId));
  const content = await cas.get(hash);
  if (content === null) {
    return err(`cas entry not found: ${hash}`);
  }
  return ok(content);
}

export async function cmdCasPut(
  storageRoot: string,
  threadId: string,
  content: string,
): Promise<Result<string, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const cas = createThreadCas(resolveCasDir(dataPath, threadId));
  const hash = await cas.put(content);
  return ok(hash);
}

export async function cmdCasList(
  storageRoot: string,
  threadId: string,
): Promise<Result<string[], string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const cas = createThreadCas(resolveCasDir(dataPath, threadId));
  const hashes = await cas.list();
  return ok(hashes);
}

export async function cmdCasRm(
  storageRoot: string,
  threadId: string,
  hash: string,
): Promise<Result<void, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const cas = createThreadCas(resolveCasDir(dataPath, threadId));
  await cas.delete(hash);
  return ok(undefined);
}
