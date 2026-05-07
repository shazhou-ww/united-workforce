import type * as z from "zod/v4";

import { llmExtractWithRetry } from "./llm-extract.js";
import { getContentMerklePayload } from "./merkle.js";
import type { ExtractContext, LlmProvider } from "./types.js";

export type ExtractFn = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  prompt: string,
  ctx: ExtractContext,
) => Promise<T>;

/**
 * Create an ExtractFn backed by an LLM provider.
 * Builds prompt text from {@link ExtractContext} plus `prompt` and calls structured extraction.
 */
export function createExtract(provider: LlmProvider): ExtractFn {
  return async <T extends Record<string, unknown>>(
    schema: z.ZodType<T>,
    prompt: string,
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
        const body = await getContentMerklePayload(ctx.cas, step.contentHash);
        if (body === null) {
          throw new Error(`extract: missing CAS blob for step ${step.role}: ${step.contentHash}`);
        }
        lines.push(`### ${step.role}`);
        lines.push(body);
        lines.push(`Meta: ${JSON.stringify(step.meta)}`);
        lines.push("");
      }
    }
    lines.push("## Agent Output");
    lines.push(ctx.agentContent);
    lines.push("");
    lines.push("## Extraction Instruction");
    lines.push(prompt);

    const text = lines.join("\n");
    const result = await llmExtractWithRetry({ text, schema, provider });
    if (!result.ok) {
      throw new Error(`extract failed: ${JSON.stringify(result.error)}`);
    }
    return result.value;
  };
}
