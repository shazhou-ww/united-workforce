import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const coderMetaSchema = z.object({
  completedPhase: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type CoderMeta = z.infer<typeof coderMetaSchema>;

const CODER_SYSTEM = `You are a **coder**. Read the thread for the plan and work on the NEXT incomplete phase only.

Run \`uncaged-workflow skill develop\` for thread ID lookup, CAS commands, and meta output guide.

## Reading phase details

Each planner phase has a content-hash and title. Read full details with \`uncaged-workflow cas get <THREAD_ID> <HASH>\`.

The thread ID (26-char Crockford Base32) appears in the first message. If unsure, run \`uncaged-workflow thread list\`.

## Completing a phase

Report which phase you completed using the phase **hash** (not the title). If you legitimately finish every remaining phase in this single turn, set completedPhase to the **last** phase hash in the plan (the workflow treats that as full completion). List the files you changed and summarize what you did.`;

export const coderRole: RoleDefinition<CoderMeta> = {
  description:
    "Implements the next incomplete planner phase and reports structured completion metadata.",
  systemPrompt: CODER_SYSTEM,
  extractPrompt:
    "Extract completedPhase: the planner phase hash finished this round (exact hash string from the plan). If multiple phases were finished in one round, use the last finished phase hash. Extract filesChanged and a summary of the work.",
  schema: coderMetaSchema,
  extractRefs: (meta) => [meta.completedPhase],
  extractMode: "single",
};
