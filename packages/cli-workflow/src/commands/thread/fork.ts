import { join } from "node:path";

import { buildForkPlan, err, generateUlid, ok, type Result } from "@uncaged/workflow";

import { pathExists, readTextFileIfExists } from "../../fs-utils.js";
import { resolveThreadDataPath } from "../../thread-scan.js";
import { ensureWorkerForHash, sendWorkerTcpCommand } from "../../worker-spawn.js";

export function parseForkArgv(
  argv: string[],
): Result<{ threadId: string; fromRole: string | null }, string> {
  if (argv.length === 0) {
    return err("fork requires <thread-id>");
  }
  const threadId = argv[0];
  if (threadId === undefined || threadId === "") {
    return err("fork requires <thread-id>");
  }
  let fromRole: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from-role") {
      const r = argv[i + 1];
      if (r === undefined || r === "") {
        return err("--from-role requires a role name");
      }
      fromRole = r;
      i++;
      continue;
    }
    return err(`unexpected argument: ${a}`);
  }
  return ok({ threadId, fromRole });
}

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
