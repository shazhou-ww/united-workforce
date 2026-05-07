import type { RoleDefinition } from "@uncaged/workflow";
import * as z from "zod/v4";

export const testerMetaSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    details: z.string(),
  }),
  z.object({
    status: z.literal("failed"),
    details: z.string(),
  }),
]);

export type TesterMeta = z.infer<typeof testerMetaSchema>;

const TESTER_SYSTEM = `You are a tester. Run the project's test suite, build, and lint commands. Check what commands are available from the preparer's output in the thread. Report pass/fail with details of what failed.`;

export const testerRole: RoleDefinition<TesterMeta> = {
  description: "Runs test, build, and lint commands and reports pass or fail with details.",
  systemPrompt: TESTER_SYSTEM,
  extractPrompt:
    "Extract the verification result: passed with summary details, or failed with details of what broke.",
  schema: testerMetaSchema,
  extractRefs: null,
  extractMode: "single",
};
