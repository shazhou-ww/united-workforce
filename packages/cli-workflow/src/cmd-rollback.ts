import { join } from "node:path";

import {
  err,
  getRegisteredWorkflow,
  ok,
  type Result,
  readWorkflowRegistry,
  rollbackWorkflowToHistoryHash,
  writeWorkflowRegistry,
} from "@uncaged/workflow";

import { pathExists } from "./fs-utils.js";
import { validateCliWorkflowName } from "./workflow-name.js";

export async function cmdRollback(
  storageRoot: string,
  name: string,
  hash: string | null,
): Promise<Result<void, string>> {
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

  const rolled = rollbackWorkflowToHistoryHash(entry, hash);
  if (!rolled.ok) {
    return err(rolled.error.message);
  }

  const bundlePath = join(storageRoot, "bundles", `${rolled.value.hash}.esm.js`);
  if (!(await pathExists(bundlePath))) {
    return err(`bundle file not found for hash ${rolled.value.hash}`);
  }

  const nextRegistry = {
    config: reg.value.config,
    workflows: { ...reg.value.workflows, [name]: rolled.value },
  };
  const written = await writeWorkflowRegistry(storageRoot, nextRegistry);
  if (!written.ok) {
    return err(written.error.message);
  }

  return ok(undefined);
}
