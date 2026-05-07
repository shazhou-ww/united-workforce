import type * as z from "zod/v4";

import { llmExtractWithRetry } from "./llm-extract.js";
import type { ExtractContext, LlmProvider } from "./types.js";

export type ExtractFn = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  ctx: ExtractContext,
) => Promise<T>;

/**
 * Create an ExtractFn backed by an LLM provider.
 * Builds prompt text from {@link ExtractContext} and calls structured extraction.
 */
export function createExtract(provider: LlmProvider): ExtractFn {
  return async <T extends Record<string, unknown>>(
    schema: z.ZodType<T>,
    ctx: ExtractContext,
  ): Promise<T> => {
    const lines: string[] = [];
    lines.push(`## Role: ${ctx.currentRole.name}`);
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
    lines.push("## Agent Output");
    lines.push(ctx.agentContent);
    lines.push("");
    lines.push("## Extraction Instruction");
    lines.push(ctx.extractPrompt);

    const text = lines.join("\n");
    const result = await llmExtractWithRetry({ text, schema, provider });
    if (!result.ok) {
      throw new Error(`extract failed: ${JSON.stringify(result.error)}`);
    }
    return result.value;
  };
}
