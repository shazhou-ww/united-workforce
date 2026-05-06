import type { AgentFn, Role, ThreadContext } from "@uncaged/workflow";
import { createRole } from "@uncaged/workflow-agent-llm";
import type { LlmProvider } from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

export const coderMetaSchema = z.object({
  completedPhase: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type CoderMeta = z.infer<typeof coderMetaSchema>;

export type CoderConfig = {
  cwd: string;
};

export const DEFAULT_CODER_CONFIG: CoderConfig = {
  cwd: ".",
};

function coderSystemPrompt(config: CoderConfig): string {
  return `You are a **coder**. The project is at \`${config.cwd}\`.

Read the thread: the planner produced ordered **phases**. Identify the **next** phase that is not yet completed according to prior coder steps (each coder step reports a completedPhase).

Implement **only that phase** — do not tackle multiple phases in one turn unless the planner defined a single phase. Follow project conventions; summarize what changed and list touched files.

When done with the phase you worked on, set **completedPhase** to that phase's **name** exactly as given by the planner.`;
}

/**
 * Coder role: implements the next incomplete planner phase and reports structured completion metadata.
 */
export function createCoderRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: CoderMeta },
  config: CoderConfig = DEFAULT_CODER_CONFIG,
): Role<CoderMeta> {
  return createRole({
    name: "coder",
    schema: coderMetaSchema,
    systemPrompt: async (_ctx: ThreadContext) => coderSystemPrompt(config),
    agent: adapter,
    extract: {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: extract.dryRunMeta,
    },
  });
}
