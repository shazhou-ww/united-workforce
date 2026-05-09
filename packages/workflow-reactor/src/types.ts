import type * as z from "zod/v4";

import type { Result } from "@uncaged/workflow-protocol";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: ToolCall[];
    }
  | { role: "assistant"; content: string }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmFn = (input: {
  messages: ChatMessage[];
  tools: readonly ToolDefinition[];
}) => Promise<Result<string, string>>;

/** Structured tool derived from the per-invocation Zod schema (e.g. extract tool). */
export type StructuredToolSpec = {
  name: string;
  tool: ToolDefinition;
};

export type ThreadReactorConfig<TThread> = {
  llm: LlmFn;
  /** Static tools (e.g. cas_get); structured tool is appended per invocation. */
  staticTools: readonly ToolDefinition[];
  /** Builds the schema-shaped tool and its OpenAI name for this invocation. */
  structuredToolFromSchema: (schema: z.ZodType<unknown>) => StructuredToolSpec;
  /** System prompt for this run; include the structured tool name for cache stability per schema. */
  systemPromptForStructuredTool: (structuredToolName: string) => string;
  toolHandler: (call: ToolCall, thread: TThread) => Promise<string>;
  maxRounds: number;
};

export type ThreadReactorInvokeArgs<TThread, T> = {
  thread: TThread;
  input: string;
  schema: z.ZodType<T>;
};

export type ThreadReactorFn<TThread> = <T>(
  args: ThreadReactorInvokeArgs<TThread, T>,
) => Promise<Result<T, string>>;
