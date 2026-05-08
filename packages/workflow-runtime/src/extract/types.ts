import type * as z from "zod/v4";

import type { ExtractContext } from "../types.js";

export type ExtractFn = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  prompt: string,
  ctx: ExtractContext,
) => Promise<T>;
