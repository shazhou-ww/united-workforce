import type * as z from "zod/v4";

import type { CasStore } from "../cas/types.js";
import {
  type AgentBinding,
  type AgentContext,
  type AgentFn,
  END,
  type ExtractContext,
  type ModeratorContext,
  type RoleDefinition,
  type RoleMeta,
  type RoleOutput,
  type RoleStep,
  START,
  type ThreadInput,
  type WorkflowCompletion,
  type WorkflowDefinition,
  type WorkflowFn,
  type WorkflowFnOptions,
} from "../types.js";
import { mergeRefsWithContentHash } from "../util/index.js";

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

async function putContentBlob(store: CasStore, raw: string): Promise<string> {
  return store.put(raw);
}

function agentForRole(binding: AgentBinding, roleName: string): AgentFn {
  const overrides = binding.overrides;
  const overrideFn: AgentFn | undefined =
    overrides !== null ? overrides[roleName as keyof typeof overrides] : undefined;
  return overrideFn !== undefined ? overrideFn : binding.agent;
}

type AdvanceOutcome<M extends RoleMeta> =
  | { kind: "complete"; completion: WorkflowCompletion }
  | { kind: "yield"; output: RoleOutput; step: RoleStep<M> };

async function advanceOneRound<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "moderator">,
  binding: AgentBinding,
  params: {
    start: ModeratorContext<M>["start"];
    steps: RoleStep<M>[];
    options: WorkflowFnOptions;
  },
): Promise<AdvanceOutcome<M>> {
  const { start, steps, options } = params;
  const modCtx: ModeratorContext<M> = {
    threadId: options.threadId,
    depth: options.depth,
    start,
    steps,
  };

  const next = def.moderator(modCtx);
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
    cas: options.cas,
  };

  const agent = agentForRole(binding, next);
  const raw = await agent(agentCtx as unknown as AgentContext);

  const extractCtx: ExtractContext<M> = {
    ...agentCtx,
    agentContent: raw,
  };

  const meta = await options.extract(
    roleDef.schema as unknown as z.ZodType<Record<string, unknown>>,
    roleDef.extractPrompt,
    extractCtx as unknown as ExtractContext,
  );

  const contentHash = await putContentBlob(options.cas, raw);
  const refs = mergeRefsWithContentHash(
    resolveExtractedRefs(roleDef as unknown as RoleDefinition<Record<string, unknown>>, meta),
    contentHash,
  );

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
    },
    step,
  };
}

/**
 * Binds pure role definitions + moderator to runtime agents.
 * Assign with `export const run = createWorkflow(def, binding)`.
 *
 * Structured meta extraction is delegated to {@link WorkflowFnOptions.extract}, which the
 * engine resolves from the workflow registry's `extract` scene.
 */
export function createWorkflow<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "moderator">,
  binding: AgentBinding,
): WorkflowFn {
  return async function* workflowLoop(
    input: ThreadInput,
    options: WorkflowFnOptions,
  ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
    const nowMs = Date.now();
    const start: ModeratorContext<M>["start"] = {
      role: START,
      content: input.prompt,
      meta: { maxRounds: options.maxRounds },
      timestamp: nowMs,
    };

    const baseTs = Date.now();
    let steps: RoleStep<M>[] = input.steps.map((out, i) => ({
      role: out.role,
      contentHash: out.contentHash,
      meta: out.meta,
      refs: out.refs,
      timestamp: baseTs + i,
    })) as RoleStep<M>[];

    while (true) {
      if (steps.length >= options.maxRounds) {
        return {
          returnCode: 0,
          summary: `completed: reached maxRounds (${options.maxRounds})`,
        };
      }

      const outcome = await advanceOneRound(def, binding, {
        start,
        steps,
        options,
      });

      if (outcome.kind === "complete") {
        return outcome.completion;
      }

      yield outcome.output;
      steps = [...steps, outcome.step];
    }
  };
}
