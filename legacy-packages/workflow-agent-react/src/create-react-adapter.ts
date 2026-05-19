import type {
  AdapterFn,
  RoleResult,
  ThreadContext,
  WorkflowRuntime,
} from "@uncaged/workflow-protocol";
import { createThreadReactor } from "@uncaged/workflow-reactor";
import { buildThreadInput } from "@uncaged/workflow-util-agent";
import * as z from "zod/v4";

import type { ReactAdapterConfig } from "./types.js";

function stripJsonSchemaMeta(json: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = json;
  return rest;
}

function readToolName(parametersSchema: Record<string, unknown>): string {
  const title = parametersSchema.title;
  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }
  return "resolve";
}

function readToolDescription(parametersSchema: Record<string, unknown>): string {
  const d = parametersSchema.description;
  if (typeof d === "string" && d.trim().length > 0) {
    return d.trim();
  }
  return "Submit the final structured result.";
}

export function createReactAdapter(config: ReactAdapterConfig): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    const reactor = createThreadReactor<ThreadContext>({
      llm: config.llm,
      staticTools: config.tools,
      structuredToolFromSchema: (s) => {
        const rawJsonSchema = z.toJSONSchema(s) as Record<string, unknown>;
        const parameters = stripJsonSchemaMeta(rawJsonSchema);
        const name = readToolName(parameters);
        return {
          name,
          tool: {
            type: "function" as const,
            function: {
              name,
              description: readToolDescription(parameters),
              parameters,
            },
          },
        };
      },
      systemPromptForStructuredTool: (_name) => prompt,
      toolHandler: async (call, _thread) => {
        return config.toolHandler(call.function.name, call.function.arguments);
      },
      maxRounds: config.maxRounds,
    });

    return async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const input = await buildThreadInput(ctx);
      const result = await reactor({ thread: ctx, input, schema });
      if (!result.ok) throw new Error(result.error);
      return { meta: result.value, childThread: null };
    };
  };
}
