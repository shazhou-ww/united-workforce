import type * as z from "zod/v4";

export type LlmProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

/** Pairs an OpenAI-compatible provider with the Zod meta schema used for structured extraction. */
export type MetaExtractConfig<T> = {
  provider: LlmProvider;
  schema: z.ZodType<T>;
};
