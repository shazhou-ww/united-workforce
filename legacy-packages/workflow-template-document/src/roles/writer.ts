import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

export const writerMetaSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("generate"),
    outputDocx: z.string(),
    sourceDocx: z.null(),
  }),
  z.object({
    mode: z.literal("edit"),
    outputDocx: z.string(),
    sourceDocx: z.string(),
  }),
]);

export type WriterMeta = z.infer<typeof writerMetaSchema>;

export const writerRole: RoleDefinition<WriterMeta> = {
  description: "Generates or modifies a Word document via an external agent.",
  systemPrompt: "",
  schema: writerMetaSchema,
};
