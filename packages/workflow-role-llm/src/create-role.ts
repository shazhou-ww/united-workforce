import type { AgentFn, Role, ThreadContext } from "@uncaged/workflow";
import type * as z from "zod/v4";
import { extractMetaOrThrow } from "./extract-meta.js";
import type { LlmProvider } from "./types.js";

export type CreateRoleArgs<M extends Record<string, unknown>> = {
  name: string;
  schema: z.ZodType<M>;
  systemPrompt: string | ((ctx: ThreadContext) => Promise<string>);
  agent: AgentFn;
  extract: {
    provider: LlmProvider;
    /** When `true`, structured extract returns `dryRunMeta`. When `null`, live API extract. */
    dryRun: boolean | null;
    dryRunMeta: M;
  };
};

function resolveExtractDryRun(extractDryRun: boolean | null): boolean {
  return extractDryRun === true;
}

/** Builds a {@link Role} from an {@link AgentFn}, system prompt, Zod meta schema, and extract wiring. */
export function createRole<M extends Record<string, unknown>>(args: CreateRoleArgs<M>): Role<M> {
  return async (ctx: ThreadContext) => {
    const promptText =
      typeof args.systemPrompt === "string" ? args.systemPrompt : await args.systemPrompt(ctx);
    const raw = await args.agent(ctx, promptText);
    const meta = await extractMetaOrThrow(args.name, raw, args.schema, {
      provider: args.extract.provider,
      dryRun: resolveExtractDryRun(args.extract.dryRun),
      dryRunMeta: args.extract.dryRunMeta,
    });
    return { content: raw, meta };
  };
}
