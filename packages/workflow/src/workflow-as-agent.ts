import { join } from "node:path";

import { extractBundleExports } from "./bundle/index.js";
import { createCasStore } from "./cas/index.js";
import type { ExecuteThreadIo } from "./engine/index.js";
import { executeThread } from "./engine/index.js";
import { getWorkflowAsAgentMaxDepth } from "./extract-provider.js";
import { getRegisteredWorkflow, readWorkflowRegistry } from "./registry/index.js";
import type { AgentContext, AgentFn, ThreadInput } from "./types.js";
import {
  createLogger,
  generateUlid,
  getDefaultWorkflowStorageRoot,
  getGlobalCasDir,
} from "./util/index.js";

export type WorkflowAsAgentOptions = {
  /** When `null`, uses `getDefaultWorkflowStorageRoot()`. */
  storageRoot: string | null;
};

function resolveWorkflowAsAgentStorageRoot(options: WorkflowAsAgentOptions | null): string {
  if (options !== null && options.storageRoot !== null) {
    return options.storageRoot;
  }
  return getDefaultWorkflowStorageRoot();
}

/**
 * Returns an {@link AgentFn} that runs another registered workflow in a new thread,
 * using the parent thread's initial prompt (`ctx.start.content`) as the child {@link ThreadInput.prompt}.
 */
export function workflowAsAgent(
  workflowName: string,
  options: WorkflowAsAgentOptions | null = null,
): AgentFn {
  return async (ctx: AgentContext): Promise<string> => {
    const nextDepth = ctx.depth + 1;

    const storageRoot = resolveWorkflowAsAgentStorageRoot(options);

    const registryResult = await readWorkflowRegistry(storageRoot);
    if (!registryResult.ok) {
      return `ERROR: failed to read workflow registry: ${registryResult.error.message}`;
    }

    const maxDepth = getWorkflowAsAgentMaxDepth(registryResult.value.config);
    if (nextDepth > maxDepth) {
      return `ERROR: workflow-as-agent depth limit exceeded (max ${maxDepth})`;
    }

    const entry = getRegisteredWorkflow(registryResult.value, workflowName);
    if (entry === null) {
      return `ERROR: workflow "${workflowName}" not found in registry`;
    }

    const bundlePath = join(storageRoot, "bundles", `${entry.hash}.esm.js`);
    const bundleExportsResult = await extractBundleExports(bundlePath, { storageRoot });
    if (!bundleExportsResult.ok) {
      return `ERROR: ${bundleExportsResult.error}`;
    }

    const input: ThreadInput = {
      prompt: ctx.start.content,
      steps: [],
    };

    const childThreadId = generateUlid(Date.now());
    const dataJsonlPath = join(storageRoot, "logs", entry.hash, `${childThreadId}.data.jsonl`);
    const infoJsonlPath = join(storageRoot, "logs", entry.hash, `${childThreadId}.info.jsonl`);

    const io: ExecuteThreadIo = {
      threadId: childThreadId,
      hash: entry.hash,
      dataJsonlPath,
      infoJsonlPath,
      cas: createCasStore(getGlobalCasDir(storageRoot)),
    };

    const logger = createLogger({ sink: { kind: "file", path: infoJsonlPath } });
    const signalNever = new AbortController();

    try {
      const result = await executeThread(
        bundleExportsResult.value.run,
        workflowName,
        input,
        {
          maxRounds: ctx.start.meta.maxRounds,
          depth: nextDepth,
          signal: signalNever.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: ctx.threadId,
          prefilledDiskSteps: null,
        },
        io,
        logger,
      );
      return result.rootHash;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return `ERROR: ${message}`;
    }
  };
}
