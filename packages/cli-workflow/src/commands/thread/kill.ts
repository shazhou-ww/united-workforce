import { join } from "node:path";

import { err, type Result } from "@uncaged/workflow";

import { readTextFileIfExists } from "../../fs-utils.js";
import {
  resolveRunningHashForThread,
  sendWorkerTcpCommand,
  type WorkerCtl,
} from "../../worker-spawn.js";

export async function cmdKill(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  const hashResult = await resolveRunningHashForThread(storageRoot, threadId);
  if (!hashResult.ok) {
    return hashResult;
  }

  const ctlPath = join(storageRoot, "workers", `${hashResult.value}.json`);
  const ctlText = await readTextFileIfExists(ctlPath);
  if (ctlText === null) {
    return err(`worker control file missing for bundle hash ${hashResult.value}`);
  }

  let ctl: WorkerCtl;
  try {
    ctl = JSON.parse(ctlText) as WorkerCtl;
  } catch {
    return err(`corrupt worker control file: ${ctlPath}`);
  }

  if (typeof ctl.port !== "number" || ctl.port <= 0) {
    return err(`invalid worker control file: ${ctlPath}`);
  }

  return await sendWorkerTcpCommand(
    ctl.port,
    { type: "kill", threadId },
    { awaitResponseLine: true },
  );
}
