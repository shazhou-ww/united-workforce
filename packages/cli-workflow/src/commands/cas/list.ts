import { ok, type Result } from "@uncaged/workflow-protocol";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { createCasStore } from "@uncaged/workflow-cas";

export async function cmdCasList(storageRoot: string): Promise<Result<string[], string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const hashes = await cas.list();
  return ok(hashes);
}
