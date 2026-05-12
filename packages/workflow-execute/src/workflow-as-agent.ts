import { join } from "node:path";
import { createCasStore } from "@uncaged/workflow-cas";
import type { WorkflowConfig } from "@uncaged/workflow-register";
import {
  extractBundleExports,
  getRegisteredWorkflow,
  readWorkflowRegistry,
} from "@uncaged/workflow-register";
import type { AgentContext, AgentFn, AgentFnResult } from "@uncaged/workflow-runtime";
import {
  createLogger,
  generateUlid,
  getDefaultWorkflowStorageRoot,
  getGlobalCasDir,
} from "@uncaged/workflow-util";
import type { ExecuteThreadIo } from "./engine/index.js";
import { executeThread, getBundleDir, readThreadsIndex } from "./engine/index.js";

const DEFAULT_WORKFLOW_AS_AGENT_MAX_DEPTH = 3;

function workflowAsAgentMaxDepth(config: WorkflowConfig | null): number {
  if (config === null) {
    return DEFAULT_WORKFLOW_AS_AGENT_MAX_DEPTH;
  }
  return config.maxDepth;
}

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

async function readParentHeadState(storageRoot: string, ctx: AgentContext): Promise<string | null> {
  const bundleDir = getBundleDir(storageRoot, ctx.bundleHash);
  const index = await readThreadsIndex(bundleDir);
  const entry = index[ctx.threadId] ?? null;
  return entry !== null ? entry.head : null;
}

/**
 * Returns an {@link AgentFn} that runs another registered workflow in a new thread,
 * using the parent thread's initial prompt (`ctx.start.content`) as the child prompt.
 */
export function workflowAsAgent(
  workflowName: string,
  options: WorkflowAsAgentOptions | null = null,
): AgentFn {
  return async (ctx: AgentContext): Promise<AgentFnResult> => {
    const nextDepth = ctx.depth + 1;

    const storageRoot = resolveWorkflowAsAgentStorageRoot(options);

    const registryResult = await readWorkflowRegistry(storageRoot);
    if (!registryResult.ok) {
      return { output: `ERROR: failed to read workflow registry: ${registryResult.error.message}`, childThread: null };
    }

    const maxDepth = workflowAsAgentMaxDepth(registryResult.value.config);
    if (nextDepth > maxDepth) {
      return { output: `ERROR: workflow-as-agent depth limit exceeded (max ${maxDepth})`, childThread: null };
    }

    const entry = getRegisteredWorkflow(registryResult.value, workflowName);
    if (entry === null) {
      return { output: `ERROR: workflow "${workflowName}" not found in registry`, childThread: null };
    }

    const bundlePath = join(storageRoot, "bundles", `${entry.hash}.esm.js`);
    const bundleExportsResult = await extractBundleExports(bundlePath, { storageRoot });
    if (!bundleExportsResult.ok) {
      return { output: `ERROR: ${bundleExportsResult.error}`, childThread: null };
    }

    const input = {
      prompt: ctx.start.content,
      steps: [],
    };

    const childThreadId = generateUlid(Date.now());
    const infoJsonlPath = join(storageRoot, "logs", entry.hash, `${childThreadId}.info.jsonl`);

    const io: ExecuteThreadIo = {
      threadId: childThreadId,
      hash: entry.hash,
      infoJsonlPath,
      cas: createCasStore(getGlobalCasDir(storageRoot)),
    };

    const logger = createLogger({ sink: { kind: "file", path: infoJsonlPath } });
    const signalNever = new AbortController();

    const parentHeadState = await readParentHeadState(storageRoot, ctx);

    try {
      const result = await executeThread(
        bundleExportsResult.value.run,
        workflowName,
        input,
        {
          depth: nextDepth,
          parentStateHash: parentHeadState,
          signal: signalNever.signal,
          awaitAfterEachYield: async () => {},
          forkSourceThreadId: ctx.threadId,
          prefilledDiskSteps: null,
          forkContinuation: null,
          replayTimestamps: null,
          storageRoot,
        },
        io,
        logger,
      );
      const summary = `Child workflow "${workflowName}" completed (returnCode=${result.returnCode}).\n\nSummary: ${result.summary}\n\nChild thread root hash: ${result.rootHash}`;
      return { output: summary, childThread: result.rootHash };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { output: `ERROR: ${message}`, childThread: null };
    }
  };
}
