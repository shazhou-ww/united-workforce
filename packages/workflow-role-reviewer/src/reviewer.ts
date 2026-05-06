import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const reviewerMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("approved"),
  }),
  z.object({
    status: z.literal("rejected"),
    issues: z.array(z.string()).describe("blocking issues that must be fixed"),
  }),
]);
export type ReviewerMeta = z.infer<typeof reviewerMetaSchema>;

const REVIEWER_SYSTEM = `You are a code reviewer. Review the current git diff. Give a clear approve or reject verdict.
Only reject for blocking issues. End with your verdict.`;

export const reviewerRole: RoleDefinition<ReviewerMeta> = {
  description: "Runs git diff checks and sets approved when the change is ready.",
  systemPrompt: REVIEWER_SYSTEM,
  schema: reviewerMetaSchema,
};
