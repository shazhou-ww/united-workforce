import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

export const developerMetaSchema = z.object({
  branch: z.string(),
  commitSha: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type DeveloperMeta = z.infer<typeof developerMetaSchema>;

const DEVELOPER_SYSTEM = `You are the **developer**. You delegate the implementation work to the \`develop\` workflow.

The actual implementation (planning → coding → reviewing → testing → committing) is handled by a child workflow that runs in your place. Your output is the Merkle DAG root hash of that child thread.

Pass through the task and let the child workflow do the work.`;

export const developerRole: RoleDefinition<DeveloperMeta> = {
  description:
    "Delegates the actual implementation to the develop workflow (workflow-as-agent). Produces a summary by traversing the child thread's Merkle DAG.",
  systemPrompt: DEVELOPER_SYSTEM,
  schema: developerMetaSchema,
};
