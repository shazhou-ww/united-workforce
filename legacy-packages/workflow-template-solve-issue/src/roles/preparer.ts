import type { RoleDefinition } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

const toolchainSchema = z.object({
  packageManager: z.union([z.string(), z.null()]),
  testCommand: z.union([z.string(), z.null()]),
  lintCommand: z.union([z.string(), z.null()]),
  buildCommand: z.union([z.string(), z.null()]),
});

export const preparerMetaSchema = z.object({
  repoPath: z.string(),
  defaultBranch: z.string(),
  conventions: z.union([z.string(), z.null()]),
  toolchain: toolchainSchema,
});

export type PreparerMeta = z.infer<typeof preparerMetaSchema>;

const PREPARER_SYSTEM = `You are a **preparer** for a software task. Your job is to locate (or clone) the target repository locally, ensure it is up to date, and gather project context before work begins.

## Responsibilities

1. Parse the issue/task prompt to identify the target repository (URL, org/repo, or name).
2. Search for an existing local clone in these locations (in order):
   - ~/Code/<repo-name>/
   - ~/repos/<repo-name>/
   - ~/Code/<org>/<repo-name>/
   - ~/repos/<org>/<repo-name>/
3. If not found locally, \`git clone\` it into ~/repos/<repo-name>/.
4. \`git checkout main && git pull\` (or the default branch) to ensure latest.
5. Read project conventions: \`CLAUDE.md\`, \`CONTRIBUTING.md\`, \`.cursor/rules/*.mdc\`, \`CONVENTIONS.md\`.
6. Detect toolchain: package manager, test runner, linter, build system.

## Output

Report your findings as structured data:
- **repoPath**: absolute path to the local repo
- **defaultBranch**: the default branch name (e.g. "main")
- **conventions**: a summary of project conventions found, or null if none
- **toolchain**: detected commands for packageManager, testCommand, lintCommand, buildCommand (null if not detected)`;

export const preparerRole: RoleDefinition<PreparerMeta> = {
  description:
    "Locates or clones the target repository, ensures it is up to date, and gathers project context (conventions, toolchain).",
  systemPrompt: PREPARER_SYSTEM,
  schema: preparerMetaSchema,
};
