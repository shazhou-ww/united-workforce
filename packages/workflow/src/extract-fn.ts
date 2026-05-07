import type * as z from "zod/v4";

import { llmExtractWithRetry } from "./llm-extract.js";
import type { LlmProvider, ThreadContext } from "./types.js";

/**
 * Curried extract: bind a schema + prompt, get a function that extracts from ThreadContext.
 */
export type ExtractFn = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  prompt: string,
) => (ctx: ThreadContext) => Promise<T>;

/**
 * Create an ExtractFn backed by an LLM provider.
 * The returned function uses the thread context (currentRole.systemPrompt + steps) as source text
 * for structured extraction.
 */
export function createExtract(provider: LlmProvider): ExtractFn {
  return <T extends Record<string, unknown>>(schema: z.ZodType<T>, prompt: string) => {
    return async (ctx: ThreadContext): Promise<T> => {
      const lines: string[] = [];
      lines.push("## Current Role");
      lines.push(ctx.currentRole.systemPrompt);
      lines.push("");
      lines.push("## Task");
      lines.push(ctx.start.content);
      lines.push("");
      if (ctx.steps.length > 0) {
        lines.push("## Thread History");
        for (const step of ctx.steps) {
          lines.push(`### ${step.role}`);
          lines.push(step.content);
          lines.push(`Meta: ${JSON.stringify(step.meta)}`);
          lines.push("");
        }
      }
      lines.push("## Extraction Instruction");
      lines.push(prompt);

      const text = lines.join("\n");
      const result = await llmExtractWithRetry({ text, schema, provider });
      if (!result.ok) {
        throw new Error(`extract failed: ${JSON.stringify(result.error)}`);
      }
      return result.value;
    };
  };
}
