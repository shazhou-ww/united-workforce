import type { RoleDefinition } from "@uncaged/workflow";
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

const PLANNER_SYSTEM = `You are a **planner** for a software task. Break the work into **sequential phases** the coder will execute one at a time.

Each phase must have: a short **name** (stable identifier), a **description** of what to do in that phase, and **acceptance** criteria for when that phase is done.

Order phases so earlier steps unblock later ones. Cover root cause, edge cases, and verification across the phases. Do not emit separate file lists or a free-form "approach" field — put that detail inside phase descriptions.`;

export const plannerRole: RoleDefinition<PlannerMeta> = {
  description: "Breaks the task into sequential phases for the coder.",
  systemPrompt: PLANNER_SYSTEM,
  extractPrompt:
    "Extract the implementation phases from the agent's analysis. Each phase needs a name, description, and acceptance criteria.",
  schema: plannerMetaSchema,
};
