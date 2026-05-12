import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import { tableToModerator } from "@uncaged/workflow-protocol/moderator-table.js";
import type * as z from "zod/v4";

import {
  type AdvanceOutcome,
  type AgentBinding,
  type AgentContext,
  type AgentFn,
  type AgentFnResult,
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

function normalizeAgentResult(result: AgentFnResult): {
  output: string;
  childThread: string | null;
} {
  if (typeof result === "string") {
    return { output: result, childThread: null };
  }
  return result;
}

function agentForRole(binding: AgentBinding, roleName: string): AgentFn {
  const overrides = binding.overrides;
  const overrideFn: AgentFn | undefined =
    overrides !== null ? overrides[roleName as keyof typeof overrides] : undefined;
  return overrideFn !== undefined ? overrideFn : binding.agent;
}

async function advanceOneRound<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles"> & {
    pickNext: (ctx: ModeratorContext<M>) => (keyof M & string) | typeof END;
  },
  binding: AgentBinding,
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

  const agentCtx: AgentContext<M> = {
    ...modCtx,
    currentRole: { name: next, systemPrompt: roleDef.systemPrompt },
  };

  const agent = agentForRole(binding, next);
  const agentResult = normalizeAgentResult(await agent(agentCtx as unknown as AgentContext));

  const agentContentHash = await putContentNodeWithRefs(runtime.cas, agentResult.output, []);

  const extracted = await runtime.extract(
    roleDef.schema as z.ZodType<Record<string, unknown>>,
    agentContentHash,
  );

  const refsFromMeta = resolveExtractedRefs(
    roleDef as unknown as RoleDefinition<Record<string, unknown>>,
    extracted.meta,
  );
  const artifactRefs = mergeUniqueHashes(extracted.refs, refsFromMeta);

  const contentHash =
    artifactRefs.length === 0
      ? agentContentHash
      : await putContentNodeWithRefs(runtime.cas, extracted.contentPayload, artifactRefs);
  const refs = artifactRefs.includes(contentHash) ? artifactRefs : [...artifactRefs, contentHash];

  const step = {
    role: next,
    contentHash,
    meta: extracted.meta,
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
      childThread: agentResult.childThread,
    },
    step,
  };
}

/**
 * Binds pure role definitions + moderator table to runtime agents.
 * Assign with `export const run = createWorkflow(def, binding)`.
 *
 * Structured meta extraction is delegated to {@link WorkflowRuntime.extract}, which the
 * engine resolves from the workflow registry's `extract` scene.
 */
export function createWorkflow<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "table">,
  binding: AgentBinding,
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
