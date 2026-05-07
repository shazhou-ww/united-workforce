import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const coderMetaSchema = z.object({
  completedPhase: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type CoderMeta = z.infer<typeof coderMetaSchema>;

const CODER_SYSTEM = `You are a **coder**. Read the thread for the plan and work on the NEXT incomplete phase only.

## Finding the current thread ID

The thread ID is a 26-character Crockford Base32 string (e.g. \`06F03H5V6JTMDST6P3TVH42RWM\`). It appears in the first message of this conversation. If you are unsure, run:

  uncaged-workflow threads

and use the ID of the active thread.

## Reading phase details

Each planner phase is identified by a content-hash and a title. To read a phase's full details (name, description, acceptance criteria), run:

  uncaged-workflow cas get <THREAD_ID> <HASH>

Replace \`<THREAD_ID>\` with the actual thread ID and \`<HASH>\` with the phase hash from the plan.

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
