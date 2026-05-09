import { ok, type Result } from "@uncaged/workflow-protocol";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { createCasStore } from "@uncaged/workflow-cas";

export async function cmdCasPut(
  storageRoot: string,
  content: string,
): Promise<Result<string, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const hash = await cas.put(content);
  return ok(hash);
}
