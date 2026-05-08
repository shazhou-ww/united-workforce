import type { Result } from "@uncaged/workflow";

import {
  readWorkerCtl,
  resolveRunningHashForThread,
  sendWorkerTcpCommand,
} from "../../worker-spawn.js";

type ThreadControlAction = "kill" | "pause" | "resume";

async function cmdThreadControl(
  storageRoot: string,
  threadId: string,
  action: ThreadControlAction,
): Promise<Result<void, string>> {
  const hashResult = await resolveRunningHashForThread(storageRoot, threadId);
  if (!hashResult.ok) {
    return hashResult;
  }

  const ctlResult = await readWorkerCtl(storageRoot, hashResult.value);
  if (!ctlResult.ok) {
    return ctlResult;
  }

  return await sendWorkerTcpCommand(
    ctlResult.value.port,
    { type: action, threadId },
    { awaitResponseLine: true },
  );
}

export async function cmdKill(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  return cmdThreadControl(storageRoot, threadId, "kill");
}

export async function cmdPause(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  return cmdThreadControl(storageRoot, threadId, "pause");
}

export async function cmdResume(
  storageRoot: string,
  threadId: string,
): Promise<Result<void, string>> {
  return cmdThreadControl(storageRoot, threadId, "resume");
}
