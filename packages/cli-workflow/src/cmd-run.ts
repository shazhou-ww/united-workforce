import { join } from "node:path";

import {
  err,
  generateUlid,
  getRegisteredWorkflow,
  ok,
  type Result,
  readWorkflowRegistry,
} from "@uncaged/workflow";
import { ensureWorkerForHash, sendWorkerTcpCommand } from "./worker-spawn.js";
import { validateCliWorkflowName } from "./workflow-name.js";

export async function cmdRun(
  storageRoot: string,
  name: string,
  prompt: string,
  isDryRun: boolean,
  maxRounds: number,
): Promise<Result<{ threadId: string }, string>> {
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

  const bundlePath = join(storageRoot, "bundles", `${entry.hash}.esm.js`);
  const worker = await ensureWorkerForHash(storageRoot, entry.hash, bundlePath);
  if (!worker.ok) {
    return worker;
  }

  const threadId = generateUlid(Date.now());
  const sent = await sendWorkerTcpCommand(worker.value.port, {
    type: "run",
    threadId,
    workflowName: name,
    prompt,
    options: { isDryRun, maxRounds },
  });
  if (!sent.ok) {
    return sent;
  }

  return ok({ threadId });
}
