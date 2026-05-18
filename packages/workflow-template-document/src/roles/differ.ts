import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

export const differMetaSchema = z.object({
  sourceDocx: z.string(),
  modifiedDocx: z.string(),
  diffDocx: z.string(),
});

export type DifferMeta = z.infer<typeof differMetaSchema>;

export const differRole: RoleDefinition<DifferMeta> = {
  description: "Produces a Word-format diff report of the writer's changes (edit mode only).",
  systemPrompt: "",
  schema: differMetaSchema,
};
