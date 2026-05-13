import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type {
  AdapterFn,
  RoleResult,
  ThreadContext,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";

/**
 * Result from a text-producing agent (CLI spawn, LLM call, etc.).
 * `output` is the raw text; `childThread` links to a spawned sub-workflow.
 */
export type TextAdapterResult = {
  output: string;
  childThread: string | null;
};

/**
 * A function that produces raw text output given the thread context and
 * the system prompt for the current role.
 */
export type TextProducerFn = (
  ctx: ThreadContext,
  prompt: string,
) => Promise<string | TextAdapterResult>;

/**
 * Creates an {@link AdapterFn} from a text-producing function.
 *
 * The adapter:
 * 1. Calls the producer with thread context + system prompt
 * 2. Stores output in CAS
 * 3. Runs the extract phase to produce typed meta
 * 4. Returns `{ meta, childThread }`
 */
export function createTextAdapter(producer: TextProducerFn): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    return async (ctx: ThreadContext, runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const result = await producer(ctx, prompt);
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
