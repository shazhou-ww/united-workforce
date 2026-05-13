import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import { tableToModerator } from "@uncaged/workflow-protocol/moderator-table.js";
import type * as z from "zod/v4";

import {
  type AdapterBinding,
  type AdapterFn,
  type AdvanceOutcome,
  END,
  type ModeratorContext,
  type RoleDefinition,
  type RoleMeta,
  type RoleOutput,
  type RoleStep,
  START,
  type ThreadContext,
  type WorkflowCompletion,
  type WorkflowDefinition,
  type WorkflowFn,
  type WorkflowRuntime,
} from "./types.js";

function isRoleNext<M extends RoleMeta>(
  next: (keyof M & string) | typeof END,
): next is keyof M & string {
  return next !== END;
}

function resolveExtractedRefs(
  roleDef: RoleDefinition<Record<string, unknown>>,
  meta: unknown,
): string[] {
  const extractRefsFn = roleDef.extractRefs;
  if (extractRefsFn === null || typeof extractRefsFn !== "function") {
    return [];
  }
  return extractRefsFn(meta as Record<string, unknown>);
}

function mergeUniqueHashes(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of [...a, ...b]) {
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

function adapterForRole(binding: AdapterBinding, roleName: string): AdapterFn {
  const overrides = binding.overrides;
  const overrideFn: AdapterFn | undefined =
    overrides !== null ? overrides[roleName as keyof typeof overrides] : undefined;
  return overrideFn !== undefined ? overrideFn : binding.adapter;
}

async function advanceOneRound<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles"> & {
    pickNext: (ctx: ModeratorContext<M>) => (keyof M & string) | typeof END;
  },
  binding: AdapterBinding,
  params: {
    thread: ModeratorContext<M>;
    runtime: WorkflowRuntime;
  },
): Promise<AdvanceOutcome<M>> {
  const { thread, runtime } = params;
  const modCtx: ModeratorContext<M> = thread;

  const next = def.pickNext(modCtx);
  if (!isRoleNext(next)) {
    return {
      kind: "complete",
      completion: { returnCode: 0, summary: "completed: moderator returned END" },
    };
  }

  const roleDef = def.roles[next];
  if (roleDef === undefined) {
    return { kind: "complete", completion: { returnCode: 1, summary: `unknown role: ${next}` } };
  }

  const adapter = adapterForRole(binding, next);
  const roleFn = adapter(roleDef.systemPrompt, roleDef.schema as z.ZodType<Record<string, unknown>>);
  const meta = await roleFn(modCtx as unknown as ThreadContext, runtime);

  const refsFromMeta = resolveExtractedRefs(
    roleDef as unknown as RoleDefinition<Record<string, unknown>>,
    meta,
  );

  const contentPayload = JSON.stringify(meta);
  const contentHash = await putContentNodeWithRefs(runtime.cas, contentPayload, refsFromMeta);
  const refs = refsFromMeta.length === 0 ? [contentHash] : [...refsFromMeta, contentHash];

  const step = {
    role: next,
    contentHash,
    meta,
    refs,
    timestamp: Date.now(),
  } as RoleStep<M>;

  return {
    kind: "yield",
    output: {
      role: step.role,
      contentHash: step.contentHash,
      meta: step.meta,
      refs: step.refs,
      childThread: null,
    },
    step,
  };
}

/**
 * Binds pure role definitions + moderator table to an adapter.
 * Assign with `export const run = createWorkflow(def, binding)`.
 *
 * The adapter is responsible for returning typed meta directly — no separate
 * extract call is needed.
 */
export function createWorkflow<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "table">,
  binding: AdapterBinding,
): WorkflowFn {
  const pickNext = tableToModerator(def.table);
  const loopDef = { roles: def.roles, pickNext };

  return async function* workflowLoop(
    thread: ThreadContext,
    runtime: WorkflowRuntime,
  ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
    if (thread.start.role !== START) {
      throw new Error(`workflow loop expected start role to be ${START}`);
    }
    let currentThread = thread as ModeratorContext<M>;

    while (true) {
      const outcome = await advanceOneRound(loopDef, binding, {
        thread: currentThread,
        runtime,
      });

      if (outcome.kind === "complete") {
        return outcome.completion;
      }

      yield outcome.output;
      currentThread = {
        ...currentThread,
        steps: [...currentThread.steps, outcome.step],
      };
    }
  };
}
