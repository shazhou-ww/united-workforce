import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const submitterMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("submitted"),
    prUrl: z.string(),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.string(),
  }),
]);

export type SubmitterMeta = z.infer<typeof submitterMetaSchema>;

const SUBMITTER_SYSTEM = `You are the **submitter**. Your job is to push the work branch to the remote and open a pull request.

## Inputs

Read the thread for context:
- The **preparer**'s output gives you the absolute repo path and the default branch (and remote URL by inspecting the repo).
- The **developer**'s output gives you the branch name that was committed and a list of files changed plus a summary of the work.

## Procedure

1. \`cd\` into the repo path from the preparer's output.
2. Push the developer's branch to the remote: \`git push -u origin <branch>\`.
3. Open a pull request (e.g. via \`gh pr create\`) targeting the default branch. The PR title should be short and describe the change. The PR description should summarize what changed (drawing from the developer's summary and filesChanged) and reference the original issue/task if applicable.
4. Report the resulting PR URL.

On any failure (push rejected, gh not authenticated, PR creation failed, etc.), report status="failed" with a short error message. Do not retry — surface the error so the moderator can decide.`;

const SUBMITTER_EXTRACT_PROMPT =
  "Extract the submission result. status='submitted' with prUrl on success, or status='failed' with a short error message on failure.";

export const submitterRole: RoleDefinition<SubmitterMeta> = {
  description: "Pushes the developer's branch to the remote and opens a pull request.",
  systemPrompt: SUBMITTER_SYSTEM,
  extractPrompt: SUBMITTER_EXTRACT_PROMPT,
  schema: submitterMetaSchema,
  extractRefs: null,
  extractMode: "single",
};
