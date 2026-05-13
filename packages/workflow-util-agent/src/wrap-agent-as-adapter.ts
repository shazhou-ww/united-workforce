import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type {
  AdapterFn,
  AgentContext,
  AgentFnResult,
  RoleResult,
  ThreadContext,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";

/**
 * Wraps a legacy AgentFn into an AdapterFn.
 * The agent produces a string (or { output, childThread }); the adapter
 * stores the output in CAS, runs extract, and returns typed meta + childThread.
 */
export function wrapAgentAsAdapter(
  agentFn: (ctx: AgentContext) => Promise<AgentFnResult>,
): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    return async (ctx: ThreadContext, runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const agentCtx: AgentContext = {
        ...ctx,
        currentRole: { name: "agent", systemPrompt: prompt },
      };
      const result = await agentFn(agentCtx);
      const output = typeof result === "string" ? result : result.output;
      const childThread = typeof result === "string" ? null : result.childThread;
      const contentHash = await putContentNodeWithRefs(runtime.cas, output, []);
      const extracted = await runtime.extract(
        schema as z.ZodType<Record<string, unknown>>,
        contentHash,
      );
      return { meta: extracted.meta as T, childThread };
    };
  };
}
