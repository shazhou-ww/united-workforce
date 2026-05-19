import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { getRegisteredWorkflow, readWorkflowRegistry } from "@uncaged/workflow-register";

import { validateCliWorkflowName } from "../../workflow-name.js";

export async function cmdHistory(
  storageRoot: string,
  name: string,
): Promise<Result<string[], string>> {
  const nameOk = validateCliWorkflowName(name);
  if (!nameOk.ok) {
    return nameOk;
  }

  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    return err(reg.error.message);
  }

  const entry = getRegisteredWorkflow(reg.value, name);
  if (entry === null) {
    return err(`workflow not registered: ${name}`);
  }

  type Row = { hash: string; timestamp: number; isCurrent: boolean };
  const rows: Row[] = [
    { hash: entry.hash, timestamp: entry.timestamp, isCurrent: true },
    ...entry.history.map((h) => ({ hash: h.hash, timestamp: h.timestamp, isCurrent: false })),
  ];
  rows.sort((a, b) => b.timestamp - a.timestamp);

  const lines = rows.map((r) => {
    const date = new Date(r.timestamp).toISOString();
    const suffix = r.isCurrent ? "\t(current)" : "";
    return `${r.hash}\t${date}${suffix}`;
  });
  return ok(lines);
}
