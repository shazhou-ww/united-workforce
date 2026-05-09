import { createCasStore } from "@uncaged/workflow-cas";
import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { getGlobalCasDir } from "@uncaged/workflow-util";

export async function cmdCasGet(
  storageRoot: string,
  hash: string,
): Promise<Result<string, string>> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const content = await cas.get(hash);
  if (content === null) {
    return err(`cas entry not found: ${hash}`);
  }
  return ok(content);
}
