import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { listHistoricalThreads } from "../../thread-scan.js";
import { validateCliWorkflowName } from "../../workflow-name.js";

export async function cmdThreads(
  storageRoot: string,
  argv: string[],
): Promise<Result<string[], string>> {
  const nameFilter = argv[0];
  if (argv.length > 1) {
    return err("threads expects at most one workflow name argument");
  }

  let workflowNameFilter: string | null = null;
  if (nameFilter !== undefined) {
    const nameOk = validateCliWorkflowName(nameFilter);
    if (!nameOk.ok) {
      return nameOk;
    }
    workflowNameFilter = nameFilter;
  }

  const rows = await listHistoricalThreads(storageRoot, workflowNameFilter);
  if (rows.length === 0) {
    return ok(["(no threads found)"]);
  }

  const lines = rows.map((r) => `${r.threadId}\t${r.hash}\t${r.workflowName ?? "(unknown)"}`);
  return ok(lines);
}
