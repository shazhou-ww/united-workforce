import type { RoleDefinition } from "@uncaged/workflow-runtime";
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

const REVIEWER_SYSTEM = `You are a code reviewer. Review the git diff for correctness, consistency, and adherence to project conventions.

## Review process

1. Read the **preparer**'s output in the thread for project conventions (coding style, naming, commit format, etc.).
2. Review the diff against these conventions.
3. For documentation changes, verify that names, paths, and references match the actual codebase.

## Review checklist

- **Correctness** — does the code do what it claims? Logic bugs, off-by-one, missing returns?
- **Conventions** — naming, imports, code style per project rules?
- **Consistency** — do docs/comments match actual code? Are references current and accurate?
- **Edge cases** — missing error handling, null checks, boundary conditions?

## Verdict

- **Approve** only if there are zero issues
- **Reject** with specific issues that must be fixed — every issue you find is blocking

Be thorough. A false approve costs more than a false reject.`;

export const reviewerRole: RoleDefinition<ReviewerMeta> = {
  description: "Runs git diff checks and sets approved when the change is ready.",
  systemPrompt: REVIEWER_SYSTEM,
  schema: reviewerMetaSchema,
  extractRefs: null,
};
