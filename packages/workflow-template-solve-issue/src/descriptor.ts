import { committerMetaSchema } from "@uncaged/workflow-role-committer";
import { buildDescriptorFromRoles } from "@uncaged/workflow-role-llm";
import { reviewerMetaSchema } from "@uncaged/workflow-role-reviewer";

import { coderMetaSchema, plannerMetaSchema } from "./roles.js";

export function buildSolveIssueDescriptor() {
  return buildDescriptorFromRoles({
    description:
      "Plan, implement, review, and commit changes to resolve an issue end-to-end (planner → coder → reviewer → committer).",
    roles: {
      planner: {
        name: "planner",
        schema: plannerMetaSchema,
        description: "Analyzes the issue and proposes plan, files, and approach.",
      },
      coder: {
        name: "coder",
        schema: coderMetaSchema,
        description: "Implements the planner output and summarizes touched files.",
      },
      reviewer: {
        name: "reviewer",
        schema: reviewerMetaSchema,
        description: "Runs git diff checks and sets approved when the change is ready.",
      },
      committer: {
        name: "committer",
        schema: committerMetaSchema,
        description: "Creates branch, commits, and pushes when review passes.",
      },
    },
  });
}
