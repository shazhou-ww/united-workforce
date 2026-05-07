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

## Finding the current thread ID

The thread ID is a 26-character Crockford Base32 string (e.g. \`06F03H5V6JTMDST6P3TVH42RWM\`). It appears in the first message of this conversation. If you are unsure, run:

  uncaged-workflow threads

and use the ID of the active thread.

## Storing phase details — MANDATORY

For each phase you MUST store its full detail text in CAS using this exact CLI command:

  uncaged-workflow cas put <THREAD_ID> '# <name>

Description: <description>

Acceptance: <acceptance>'

Replace \`<THREAD_ID>\` with the actual thread ID you found above. The command prints a content-hash to stdout — use that hash as the phase identifier.

**Do NOT store phase details in any other way** (no temp files, no invented paths). The CLI command is the only supported storage mechanism.

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
};
