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

Run \`uncaged-workflow skill develop\` for thread ID lookup, CAS commands, and meta output guide.

## Storing phase details — MANDATORY

For each phase, store its full detail text in CAS via \`uncaged-workflow cas put <THREAD_ID> '<content>'\`. The command prints a content-hash — use that as the phase identifier.

The thread ID (26-char Crockford Base32) appears in the first message. If unsure, run \`uncaged-workflow thread list\`.

**Do NOT store phase details in any other way** — the CLI is the only supported storage mechanism.

## Phase granularity

Match the number of phases to task complexity:
- Trivial (add a config option, fix a typo, rename): 1 phase
- Small (a new feature touching 2-3 files): 1-2 phases
- Medium (cross-module refactor): 2-3 phases
- Large (new subsystem, architectural change): 3-5 phases

Fewer phases is always better. Each phase must justify its existence — if two phases would be tested together anyway, merge them.

## Output format

After storing all phases via the CLI, output compact JSON only:
  { "phases": [{ "hash": "<hash-from-cas-put>", "title": "<one-line-summary>" }] }

Order phases so earlier steps unblock later ones. Cover root cause, edge cases, and verification across the phases.`;

export const plannerRole: RoleDefinition<PlannerMeta> = {
  description: "Breaks the task into sequential phases for the coder.",
  systemPrompt: PLANNER_SYSTEM,
  extractPrompt:
    "Extract the implementation phases from the agent's output. Each phase has a hash (the CAS content-hash returned by the cas put command) and a title (one-line summary).",
  schema: plannerMetaSchema,
  extractRefs: (meta) => meta.phases.map((p) => p.hash),
  extractMode: "single",
};
