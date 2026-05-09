import { join } from "node:path";
import { buildForkPlan } from "@uncaged/workflow-execute";
import { err, ok, type Result } from "@uncaged/workflow-protocol";
import { generateUlid } from "@uncaged/workflow-util";

import { pathExists, readTextFileIfExists } from "../../fs-utils.js";
import { resolveThreadDataPath } from "../../thread-scan.js";
import { ensureWorkerForHash, sendWorkerTcpCommand } from "../../worker-spawn.js";

export async function cmdFork(
  storageRoot: string,
  threadId: string,
  fromRole: string | null,
): Promise<Result<{ threadId: string }, string>> {
  const dataPath = await resolveThreadDataPath(storageRoot, threadId);
  if (dataPath === null) {
    return err(`thread not found: ${threadId}`);
  }
  const text = await readTextFileIfExists(dataPath);
  if (text === null) {
    return err(`thread data missing: ${threadId}`);
  }

  const plan = buildForkPlan(text, fromRole);
  if (!plan.ok) {
    return plan;
  }

  const bundlePath = join(storageRoot, "bundles", `${plan.value.hash}.esm.js`);
  if (!(await pathExists(bundlePath))) {
    return err(`bundle file missing for thread hash ${plan.value.hash}`);
  }

  const worker = await ensureWorkerForHash(storageRoot, plan.value.hash, bundlePath);
  if (!worker.ok) {
    return worker;
  }

  const newThreadId = generateUlid(Date.now());
  const stepsOnWire = plan.value.historicalSteps.map((s) => ({
    role: s.role,
    contentHash: s.contentHash,
    meta: s.meta,
    refs: s.refs,
    timestamp: s.timestamp,
  }));

  const sent = await sendWorkerTcpCommand(
    worker.value.port,
    {
      type: "run",
      threadId: newThreadId,
      workflowName: plan.value.workflowName,
      prompt: plan.value.prompt,
      options: plan.value.runOptions,
      steps: stepsOnWire,
      forkSourceThreadId: plan.value.sourceThreadId,
    },
    { awaitResponseLine: false },
  );
  if (!sent.ok) {
    return sent;
  }

  return ok({ threadId: newThreadId });
}
