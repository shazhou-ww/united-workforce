import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const phaseSchema = z.object({
  hash: z.string(),
  title: z.string(),
});

export const plannerMetaSchema = z.object({
  phases: z.array(phaseSchema),
});

export type PlannerMeta = z.infer<typeof plannerMetaSchema>;

const PLANNER_SYSTEM = `You are a **planner** for a software task. Break the work into **sequential phases** the coder will execute one at a time.

For each phase, decide on a name, detailed description, and acceptance criteria. Then store the full detail text in CAS so the coder can retrieve it later:

  uncaged-workflow cas put <thread-id> "# <name>\n\nDescription: <description>\n\nAcceptance: <acceptance>"

The command prints a content-hash to stdout. Use that hash as the phase identifier.

Your final structured output must contain compact phases only:
  { "phases": [{ "hash": "<hash-from-cas-put>", "title": "<one-line-summary>" }] }

The current thread ID is provided in the thread context. Order phases so earlier steps unblock later ones. Cover root cause, edge cases, and verification across the phases.`;

export const plannerRole: RoleDefinition<PlannerMeta> = {
  description: "Breaks the task into sequential phases for the coder.",
  systemPrompt: PLANNER_SYSTEM,
  extractPrompt:
    "Extract the implementation phases from the agent's output. Each phase has a hash (the CAS content-hash returned by the cas put command) and a title (one-line summary).",
  schema: plannerMetaSchema,
};
