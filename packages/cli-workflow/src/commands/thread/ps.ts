import { listRunningThreads } from "../../thread-scan.js";

export async function cmdPs(storageRoot: string): Promise<string[]> {
  const rows = await listRunningThreads(storageRoot);
  if (rows.length === 0) {
    return ["(no running threads)"];
  }
  return rows.map((r) => `${r.threadId}\t${r.hash}\t${r.workflowName ?? "(unknown)"}`);
}
