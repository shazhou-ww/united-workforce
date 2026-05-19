import { join } from "node:path";
import { createCasStore } from "@uncaged/workflow-cas";
import { prepareCasFork } from "@uncaged/workflow-execute";
import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { generateUlid, getGlobalCasDir } from "@uncaged/workflow-util";

import { pathExists } from "../../fs-utils.js";
import { resolveThreadRecord } from "../../thread-scan.js";
import { ensureWorkerForHash, sendWorkerTcpCommand } from "../../worker-spawn.js";

export async function cmdFork(
  storageRoot: string,
  threadId: string,
  fromRole: string | null,
): Promise<Result<{ threadId: string }, string>> {
  const resolved = await resolveThreadRecord(storageRoot, threadId);
  if (resolved === null) {
    return err(`thread not found: ${threadId}`);
  }

  const bundlePath = join(storageRoot, "bundles", `${resolved.bundleHash}.esm.js`);
  if (!(await pathExists(bundlePath))) {
    return err(`bundle file missing for thread hash ${resolved.bundleHash}`);
  }

  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const newThreadId = generateUlid(Date.now());

  const plan = await prepareCasFork({
    cas,
    bundleDir: resolved.bundleDir,
    bundleHash: resolved.bundleHash,
    sourceThreadId: threadId,
    headHash: resolved.head,
    startHash: resolved.start,
    newThreadId,
    fromRole,
  });
  if (!plan.ok) {
    return plan;
  }

  const worker = await ensureWorkerForHash(storageRoot, plan.value.hash, bundlePath);
  if (!worker.ok) {
    return worker;
  }

  const p = plan.value;
  const sent = await sendWorkerTcpCommand(
    worker.value.port,
    {
      type: "run",
      threadId: newThreadId,
      workflowName: p.workflowName,
      prompt: p.prompt,
      options: p.runOptions,
      steps: p.steps,
      stepTimestamps: p.stepTimestamps.length > 0 ? p.stepTimestamps : null,
      forkSourceThreadId: threadId,
      forkContinuation: p.forkContinuation,
    },
    { awaitResponseLine: false },
  );
  if (!sent.ok) {
    return sent;
  }

  return ok({ threadId: newThreadId });
}
