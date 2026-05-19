import type { LlmProvider } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";

export type { ExtractFn } from "@uncaged/workflow-runtime";

export type LlmExtractArgs<T> = {
  text: string;
  schema: z.ZodType<T>;
  provider: LlmProvider;
};

export type LlmError =
  | { kind: "http_error"; status: number; body: string }
  | { kind: "invalid_response_json"; message: string }
  | { kind: "no_tool_call"; preview: string }
  | { kind: "tool_arguments_invalid_json"; message: string }
  | { kind: "schema_validation_failed"; message: string }
  | { kind: "network_error"; message: string };
