import type { RoleDefinition } from "@uncaged/workflow";
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

const DEVELOPER_EXTRACT_PROMPT = `The agent output is the root CAS hash of a child workflow thread. Use the cas_get tool to traverse the Merkle DAG and extract the developer summary.

Procedure:
1. cas_get(<rootHash>) — the root node lists all child step hashes (planner, coder, reviewer, tester, committer).
2. Find the committer step. cas_get its hash to read the committer's meta — extract branch and commitSha from there.
3. Find every coder step. cas_get each to read the coder's filesChanged. Union all filesChanged across coder steps.
4. Compose a short human-readable summary describing what the develop child workflow accomplished (drawn from the coder summaries, or a synthesis of them).

Return: { branch, commitSha, filesChanged, summary }.`;

export const developerRole: RoleDefinition<DeveloperMeta> = {
  description:
    "Delegates the actual implementation to the develop workflow (workflow-as-agent). Produces a summary by traversing the child thread's Merkle DAG.",
  systemPrompt: DEVELOPER_SYSTEM,
  extractPrompt: DEVELOPER_EXTRACT_PROMPT,
  schema: developerMetaSchema,
  extractRefs: () => [],
  extractMode: "react",
};
