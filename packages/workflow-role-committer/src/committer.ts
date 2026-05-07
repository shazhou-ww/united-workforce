import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const committerMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("committed"),
    branch: z.string(),
    commitSha: z.string(),
  }),
  z.object({
    status: z.literal("recoverable"),
    error: z.string(),
    logRef: z.string().nullable(),
  }),
  z.object({
    status: z.literal("unrecoverable"),
    error: z.string(),
    logRef: z.string().nullable(),
  }),
]);

export type CommitterMeta = z.infer<typeof committerMetaSchema>;

const COMMITTER_SYSTEM = `You are the git committer. Create a branch, commit the changes, and push.
Report the branch name and commit SHA. On failure, classify as recoverable or unrecoverable.
Do not attempt to fix failures yourself.`;

export const committerRole: RoleDefinition<CommitterMeta> = {
  description: "Creates branch, commits, and pushes when review passes.",
  systemPrompt: COMMITTER_SYSTEM,
  extractPrompt:
    "Extract the commit result: committed (with branch and SHA), recoverable failure, or unrecoverable failure. Include error details and log references if applicable.",
  schema: committerMetaSchema,
  extractRefs: null,
  extractMode: "single",
};
