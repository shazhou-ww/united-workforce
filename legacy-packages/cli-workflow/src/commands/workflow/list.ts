import { err, ok, type Result } from "@uncaged/workflow-protocol";
import {
  listRegisteredWorkflowNames,
  readWorkflowRegistry,
  type WorkflowRegistryFile,
} from "@uncaged/workflow-register";

export async function cmdList(storageRoot: string): Promise<Result<WorkflowRegistryFile, string>> {
  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    return err(reg.error.message);
  }
  return ok(reg.value);
}

export function formatListLines(registry: WorkflowRegistryFile): string[] {
  const names = listRegisteredWorkflowNames(registry);
  if (names.length === 0) {
    return ["(no workflows registered)"];
  }
  const lines: string[] = [];
  for (const name of names) {
    const entry = registry.workflows[name];
    if (entry === undefined) {
      continue;
    }
    lines.push(`${name}\t${entry.hash}\t${entry.timestamp}`);
  }
  return lines;
}
