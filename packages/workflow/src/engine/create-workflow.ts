import { putContentMerkleNode } from "../cas/index.js";
import { buildExtractUserContent, reactExtract } from "../extract/index.js";
import {
  type AgentBinding,
  type AgentContext,
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

async function resolveRoleMeta<M extends RoleMeta>(
  roleDef: RoleDefinition<Record<string, unknown>>,
  extractCtx: ExtractContext<M>,
  options: WorkflowFnOptions,
): Promise<Record<string, unknown>> {
  if (roleDef.extractMode === "react") {
    if (options.llmProvider === null) {
      throw new Error(
        'createWorkflow: WorkflowFnOptions.llmProvider is required when a role uses extractMode "react"',
      );
    }
    const text = await buildExtractUserContent(
      extractCtx as unknown as ExtractContext,
      roleDef.extractPrompt,
    );
    const reactResult = await reactExtract({
      text,
      schema: roleDef.schema,
      provider: options.llmProvider,
      cas: options.cas,
    });
    if (!reactResult.ok) {
      throw new Error(`react extract failed: ${reactResult.error}`);
    }
    return reactResult.value as Record<string, unknown>;
  }
  return (await options.extract(
    roleDef.schema,
    roleDef.extractPrompt,
    extractCtx as unknown as ExtractContext,
  )) as Record<string, unknown>;
}

/**
 * Binds pure role definitions + moderator to runtime agents.
 * Assign with `export const run = createWorkflow(def, binding)`.
 * The engine supplies {@link WorkflowFnOptions.extract} and {@link WorkflowFnOptions.llmProvider} from workflow.yaml.
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

      const modCtx: ModeratorContext<M> = {
        threadId: options.threadId,
        depth: options.depth,
        start,
        steps,
      };

      const next = def.moderator(modCtx);

      if (!isRoleNext(next)) {
        return { returnCode: 0, summary: "completed: moderator returned END" };
      }

      const roleDef = def.roles[next];
      if (roleDef === undefined) {
        return { returnCode: 1, summary: `unknown role: ${next}` };
      }

      const agentCtx: AgentContext<M> = {
        ...modCtx,
        currentRole: { name: next, systemPrompt: roleDef.systemPrompt },
        cas: options.cas,
      };

      const agent = binding.overrides?.[next] ?? binding.agent;

      const raw = await agent(agentCtx as unknown as AgentContext);

      const extractCtx: ExtractContext<M> = {
        ...agentCtx,
        agentContent: raw,
      };

      const meta = await resolveRoleMeta(
        roleDef as unknown as RoleDefinition<Record<string, unknown>>,
        extractCtx,
        options,
      );

      const contentHash = await putContentMerkleNode(options.cas, raw);

      const refs = mergeRefsWithContentHash(
        resolveExtractedRefs(roleDef as unknown as RoleDefinition<Record<string, unknown>>, meta),
        contentHash,
      );

      const ts = Date.now();
      const step = {
        role: next,
        contentHash,
        meta,
        refs,
        timestamp: ts,
      } as RoleStep<M>;

      yield {
        role: step.role,
        contentHash: step.contentHash,
        meta: step.meta,
        refs: step.refs,
      };

      steps = [...steps, step];
    }
  };
}
