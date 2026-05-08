import {
  err,
  ok,
  type Result,
  readWorkflowRegistry,
  unregisterWorkflow,
  writeWorkflowRegistry,
} from "@uncaged/workflow";

import { validateCliWorkflowName } from "../../workflow-name.js";

export async function cmdRemove(storageRoot: string, name: string): Promise<Result<void, string>> {
  const nameOk = validateCliWorkflowName(name);
  if (!nameOk.ok) {
    return nameOk;
  }

  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    return err(reg.error.message);
  }

  const next = unregisterWorkflow(reg.value, name);
  if (!next.ok) {
    return err(next.error.message);
  }

  const written = await writeWorkflowRegistry(storageRoot, next.value);
  if (!written.ok) {
    return err(written.error.message);
  }

  return ok(undefined);
}
