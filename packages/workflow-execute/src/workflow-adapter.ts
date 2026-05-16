import { join } from "node:path";
import { createCasStore, putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type { WorkflowConfig } from "@uncaged/workflow-register";
import {
  extractBundleExports,
  getRegisteredWorkflow,
  readWorkflowRegistry,
} from "@uncaged/workflow-register";
import type {
  AdapterFn,
  RoleResult,
  ThreadContext,
  WorkflowFn,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import {
  createLogger,
  generateUlid,
  getDefaultWorkflowStorageRoot,
  getGlobalCasDir,
} from "@uncaged/workflow-util";
import type * as z from "zod/v4";
import type { ExecuteThreadIo } from "./engine/index.js";
import { executeThread, getBundleDir, readThreadsIndex } from "./engine/index.js";

const DEFAULT_WORKFLOW_ADAPTER_MAX_DEPTH = 3;

function workflowAdapterMaxDepth(config: WorkflowConfig | null): number {
  return config === null ? DEFAULT_WORKFLOW_ADAPTER_MAX_DEPTH : config.maxDepth;
}

export type WorkflowAdapterOptions = {
  /** When `null`, uses `getDefaultWorkflowStorageRoot()`. */
  storageRoot: string | null;
};

function resolveStorageRoot(options: WorkflowAdapterOptions | null): string {
  if (options !== null && options.storageRoot !== null) {
    return options.storageRoot;
  }
  return getDefaultWorkflowStorageRoot();
}

async function readParentHeadState(
  storageRoot: string,
  ctx: ThreadContext,
): Promise<string | null> {
  const bundleDir = getBundleDir(storageRoot, ctx.bundleHash);
  const index = await readThreadsIndex(bundleDir);
  const entry = index[ctx.threadId] ?? null;
  return entry !== null ? entry.head : null;
}

/** Resolve the workflow bundle and validate depth limits. */
async function resolveWorkflowBundle(workflowName: string, storageRoot: string, nextDepth: number) {
  const registryResult = await readWorkflowRegistry(storageRoot);
  if (!registryResult.ok) {
    throw new Error(`failed to read workflow registry: ${registryResult.error.message}`);
  }

  const maxDepth = workflowAdapterMaxDepth(registryResult.value.config);
  if (nextDepth > maxDepth) {
    throw new Error(`workflow adapter depth limit exceeded (max ${maxDepth})`);
  }

  const entry = getRegisteredWorkflow(registryResult.value, workflowName);
  if (entry === null) {
    throw new Error(`workflow "${workflowName}" not found in registry`);
  }

  const bundlePath = join(storageRoot, "bundles", `${entry.hash}.esm.js`);
  const bundleExportsResult = await extractBundleExports(bundlePath);
  if (!bundleExportsResult.ok) {
    throw new Error(String(bundleExportsResult.error));
  }

  return { entry, run: bundleExportsResult.value.run };
}

/** Execute the child workflow thread and return a summary + root hash. */
async function runChildThread(params: {
  workflowName: string;
  storageRoot: string;
  ctx: ThreadContext;
  run: WorkflowFn;
  bundleHash: string;
  nextDepth: number;
}) {
  const { workflowName, storageRoot, ctx, run, bundleHash, nextDepth } = params;
  const childThreadId = generateUlid(Date.now());
  const infoJsonlPath = join(storageRoot, "logs", bundleHash, `${childThreadId}.info.jsonl`);

  const io: ExecuteThreadIo = {
    threadId: childThreadId,
    hash: bundleHash,
    infoJsonlPath,
    cas: createCasStore(getGlobalCasDir(storageRoot)),
  };

  const logger = createLogger({ sink: { kind: "file", path: infoJsonlPath } });
  const parentHeadState = await readParentHeadState(storageRoot, ctx);

  const result = await executeThread(
    run,
    workflowName,
    { prompt: ctx.start.content, steps: [] },
    {
      depth: nextDepth,
      parentStateHash: parentHeadState,
      signal: new AbortController().signal,
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

  return {
    summary: `Child workflow "${workflowName}" completed (returnCode=${result.returnCode}).\n\nSummary: ${result.summary}\n\nChild thread root hash: ${result.rootHash}`,
    rootHash: result.rootHash,
  };
}

/**
 * Returns an {@link AdapterFn} that runs another registered workflow in a new child thread,
 * using the parent thread's initial prompt (`ctx.start.content`) as the child prompt.
 *
 * The child thread's root hash is returned as `childThread` in the result,
 * enabling parent→child tracking in the CAS Merkle tree.
 */
export function workflowAdapter(
  workflowName: string,
  options: WorkflowAdapterOptions | null = null,
): AdapterFn {
  return <T>(_prompt: string, schema: z.ZodType<T>) => {
    return async (ctx: ThreadContext, runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const storageRoot = resolveStorageRoot(options);
      const { entry, run } = await resolveWorkflowBundle(workflowName, storageRoot, ctx.depth + 1);

      try {
        const { summary, rootHash } = await runChildThread({
          workflowName,
          storageRoot,
          ctx,
          run,
          bundleHash: entry.hash,
          nextDepth: ctx.depth + 1,
        });
        const contentHash = await putContentNodeWithRefs(runtime.cas, summary, []);
        const extracted = await runtime.extract(
          schema as z.ZodType<Record<string, unknown>>,
          contentHash,
        );
        return { meta: extracted.meta as T, childThread: rootHash };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`child workflow "${workflowName}" failed: ${message}`);
      }
    };
  };
}
