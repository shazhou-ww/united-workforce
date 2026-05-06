import type * as z from "zod/v4";

import { llmExtractWithRetry } from "./llm-extract.js";
import type { LlmProvider } from "./types.js";

export async function extractMetaOrThrow<T extends Record<string, unknown>>(
  roleName: string,
  raw: string,
  schema: z.ZodType<T>,
  options: { provider: LlmProvider },
): Promise<T> {
  const result = await llmExtractWithRetry({
    text: raw,
    schema,
    provider: options.provider,
  });
  if (!result.ok) {
    throw new Error(
      `Role "${roleName}": structured extraction failed after retry: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}
