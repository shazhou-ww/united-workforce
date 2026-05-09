import { createCasStore } from "@uncaged/workflow-cas";
import { FORK_BRANCH_ROLE, walkStateFramesNewestFirst } from "@uncaged/workflow-execute";
import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";

import { resolveThreadRecord } from "../../thread-scan.js";

export async function cmdThreadShow(
  storageRoot: string,
  threadId: string,
): Promise<Result<string, string>> {
  const resolved = await resolveThreadRecord(storageRoot, threadId);
  if (resolved === null) {
    return err(`thread not found: ${threadId}`);
  }

  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const frames = await walkStateFramesNewestFirst(cas, resolved.head);
  const chronological = [...frames].reverse();

  const steps: Array<{ role: string; hash: string; timestamp: number }> = [];
  for (const fr of chronological) {
    if (fr.payload.role === END || fr.payload.role === FORK_BRANCH_ROLE) {
      continue;
    }
    steps.push({
      role: fr.payload.role,
      hash: fr.hash,
      timestamp: fr.payload.timestamp,
    });
  }

  const payload = {
    threadId: resolved.threadId,
    bundleHash: resolved.bundleHash,
    head: resolved.head,
    start: resolved.start,
    source: resolved.source,
    steps,
  };

  return ok(JSON.stringify(payload, null, 2));
}
