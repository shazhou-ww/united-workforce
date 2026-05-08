import { err, ok, type Result } from "@uncaged/workflow";

import { readTextFileIfExists } from "../../fs-utils.js";
import { resolveThreadDataPath } from "../../thread-scan.js";

export async function cmdThreadShow(
  storageRoot: string,
  threadId: string,
): Promise<Result<string, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const text = await readTextFileIfExists(dataPath);
  if (text === null) {
    return err(`thread data missing: ${threadId}`);
  }
  return ok(text.endsWith("\n") ? text.slice(0, -1) : text);
}
