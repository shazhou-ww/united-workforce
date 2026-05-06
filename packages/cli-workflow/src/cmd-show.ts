import {
  err,
  getRegisteredWorkflow,
  ok,
  type Result,
  readWorkflowRegistry,
  type WorkflowRegistryEntry,
} from "@uncaged/workflow";
import { stringify } from "yaml";

import { validateCliWorkflowName } from "./workflow-name.js";

export async function cmdShow(
  storageRoot: string,
  name: string,
): Promise<Result<WorkflowRegistryEntry, string>> {
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
    return err(`workflow not found: ${name}`);
  }
  return ok(entry);
}

export function formatShowYaml(name: string, entry: WorkflowRegistryEntry): string {
  const payload = {
    [name]: {
      hash: entry.hash,
      timestamp: entry.timestamp,
      history: entry.history,
    },
  };
  return stringify(payload, { indent: 2, defaultStringType: "QUOTE_DOUBLE" });
}
