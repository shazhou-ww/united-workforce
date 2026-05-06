import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const coderMetaSchema = z.object({
  completedPhase: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type CoderMeta = z.infer<typeof coderMetaSchema>;

const CODER_SYSTEM = `You are a **coder**. Read the thread for the plan and work on the NEXT incomplete phase only.
Report which phase you completed. List the files you changed and summarize what you did.`;

export const coderRole: RoleDefinition<CoderMeta> = {
  description:
    "Implements the next incomplete planner phase and reports structured completion metadata.",
  systemPrompt: CODER_SYSTEM,
  schema: coderMetaSchema,
};
