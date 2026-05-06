import { extractMetaOrThrow } from "./extract-meta.js";
import {
  type AgentBinding,
  END,
  type ExtractConfig,
  type RoleMeta,
  type RoleOutput,
  type RoleStep,
  START,
  type ThreadContext,
  type ThreadInput,
  type WorkflowDefinition,
  type WorkflowFn,
  type WorkflowFnOptions,
  type WorkflowResult,
} from "./types.js";

function isRoleNext<M extends RoleMeta>(
  next: (keyof M & string) | typeof END,
): next is keyof M & string {
  return next !== END;
}

function moderatorThreadContext<M extends RoleMeta>(params: {
  threadId: string;
  start: ThreadContext<M>["start"];
  steps: RoleStep<M>[];
  roles: Pick<WorkflowDefinition<M>, "roles">["roles"];
}): ThreadContext<M> {
  const { threadId, start, steps, roles } = params;
  const last = steps[steps.length - 1];
  if (last === undefined) {
    return {
      threadId,
      currentRole: { name: START, systemPrompt: "" },
      start,
      steps,
    };
  }
  const roleName = last.role as keyof M & string;
  const roleDef = roles[roleName];
  const systemPrompt = roleDef !== undefined ? roleDef.systemPrompt : "";
  return {
    threadId,
    currentRole: { name: roleName, systemPrompt },
    start,
    steps,
  };
}

/**
 * Binds pure role definitions + moderator to runtime agents and structured extraction.
 * Assign with `export const run = createWorkflow(def, binding, extract)`.
 */
export function createWorkflow<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "moderator">,
  binding: AgentBinding,
  extract: ExtractConfig,
): WorkflowFn {
  return async function* workflowLoop(
    input: ThreadInput,
    options: WorkflowFnOptions,
  ): AsyncGenerator<RoleOutput, WorkflowResult> {
    const nowMs = Date.now();
    const start: ThreadContext<M>["start"] = {
      role: START,
      content: input.prompt,
      meta: { maxRounds: options.maxRounds },
      timestamp: nowMs,
    };

    const baseTs = Date.now();
    let steps: RoleStep<M>[] = input.steps.map((out, i) => ({
      role: out.role,
      content: out.content,
      meta: out.meta,
      timestamp: baseTs + i,
    })) as RoleStep<M>[];

    while (true) {
      if (steps.length >= options.maxRounds) {
        return {
          returnCode: 0,
          summary: `completed: reached maxRounds (${options.maxRounds})`,
        };
      }

      const modCtx = moderatorThreadContext({
        threadId: options.threadId,
        start,
        steps,
        roles: def.roles,
      });

      const next = def.moderator(modCtx);

      if (!isRoleNext(next)) {
        return { returnCode: 0, summary: "completed: moderator returned END" };
      }

      const roleDef = def.roles[next];
      if (roleDef === undefined) {
        return { returnCode: 1, summary: `unknown role: ${next}` };
      }

      const ctx: ThreadContext<M> = {
        threadId: options.threadId,
        currentRole: { name: next, systemPrompt: roleDef.systemPrompt },
        start,
        steps,
      };

      const agent = binding.overrides?.[next] ?? binding.agent;

      const raw = await agent(ctx as unknown as ThreadContext);

      const meta = await extractMetaOrThrow(next, raw, roleDef.schema, {
        provider: extract.provider,
        dryRun: extract.dryRun,
        dryRunMeta: roleDef.dryRunMeta,
      });

      const ts = Date.now();
      const step = {
        role: next,
        content: raw,
        meta,
        timestamp: ts,
      } as RoleStep<M>;

      yield { role: step.role, content: step.content, meta: step.meta };

      steps = [...steps, step];
    }
  };
}
