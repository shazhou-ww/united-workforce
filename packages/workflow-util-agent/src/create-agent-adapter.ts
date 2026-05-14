import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type {
  AdapterFn,
  AgentFn,
  RoleResult,
  ThreadContext,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";

export type ExtractOptionsFn<Opt> = (
  ctx: ThreadContext,
  prompt: string,
  runtime: WorkflowRuntime,
) => Promise<Opt>;

/**
 * Bridges {@link AgentFn} to {@link AdapterFn}.
 *
 * 1. extract(ctx, prompt, runtime) → Opt
 * 2. agent(ctx, options) → raw string
 * 3. Store raw string in CAS
 * 4. runtime.extract(schema, contentHash) → typed meta T
 */
export function createAgentAdapter<Opt>(
  agent: AgentFn<Opt>,
  extract: ExtractOptionsFn<Opt>,
): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    return async (ctx: ThreadContext, runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const options = await extract(ctx, prompt, runtime);
      const raw = await (agent as (ctx: ThreadContext, optionsParam: Opt) => Promise<string>)(
        ctx,
        options,
      );
      const contentHash = await putContentNodeWithRefs(runtime.cas, raw, []);
      const extracted = await runtime.extract(
        schema as z.ZodType<Record<string, unknown>>,
        contentHash,
      );
      return { meta: extracted.meta as T, childThread: null };
    };
  };
}

export function createSimpleAgentAdapter(agent: AgentFn<void>): AdapterFn {
  return createAgentAdapter(agent, async () => undefined as unknown as undefined);
}
