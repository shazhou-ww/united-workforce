import type { AgentFn, Role, ThreadContext } from "@uncaged/workflow";
import { createRole } from "@uncaged/workflow-agent-llm";
import type { LlmProvider } from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

export const phaseSchema = z.object({
  name: z.string(),
  description: z.string(),
  acceptance: z.string(),
});

export const plannerMetaSchema = z.object({
  phases: z.array(phaseSchema),
});

export type PlannerMeta = z.infer<typeof plannerMetaSchema>;

/** Reserved for future planner options; empty for now. */
export type PlannerConfig = Record<string, never>;

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {};

const PLANNER_SYSTEM = `You are a **planner** for a software task. Break the work into **sequential phases** the coder will execute one at a time.

Each phase must have: a short **name** (stable identifier), a **description** of what to do in that phase, and **acceptance** criteria for when that phase is done.

Order phases so earlier steps unblock later ones. Cover root cause, edge cases, and verification across the phases. Do not emit separate file lists or a free-form "approach" field — put that detail inside phase descriptions.`;

function plannerSystemPrompt(_config: PlannerConfig): string {
  return PLANNER_SYSTEM;
}

/**
 * Planner role: produces ordered implementation phases for the coder to execute sequentially.
 */
export function createPlannerRole(
  adapter: AgentFn,
  extract: { provider: LlmProvider; dryRun: boolean | null; dryRunMeta: PlannerMeta },
  config: PlannerConfig = DEFAULT_PLANNER_CONFIG,
): Role<PlannerMeta> {
  return createRole({
    name: "planner",
    schema: plannerMetaSchema,
    systemPrompt: async (_ctx: ThreadContext) => plannerSystemPrompt(config),
    agent: adapter,
    extract: {
      provider: extract.provider,
      dryRun: extract.dryRun,
      dryRunMeta: extract.dryRunMeta,
    },
  });
}
