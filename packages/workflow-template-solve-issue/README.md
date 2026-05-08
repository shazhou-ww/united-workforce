# @uncaged/workflow-template-solve-issue

Reference **solve-issue** workflow template: prepare a repo, delegate implementation to the **develop** workflow, then submit (e.g. open a PR).

`createSolveIssueRun` wires the `developer` role to `workflowAsAgent("develop")` by default; `binding.overrides.developer` wins if you pass one (for tests or custom hosts).

## Install

```bash
bun add @uncaged/workflow-template-solve-issue @uncaged/workflow zod
```

In this monorepo: `workspace:*` for this package and `@uncaged/workflow`.

## Usage

```typescript
import { createSolveIssueRun, solveIssueWorkflowDefinition } from "@uncaged/workflow-template-solve-issue";

const run = createSolveIssueRun(binding);
```

## Roles

| Role | Purpose |
|------|---------|
| **preparer** | Set up context / repo state for the issue |
| **developer** | Implementation; default runs the registered `develop` workflow as a sub-agent |
| **submitter** | Finalize and submit the outcome (e.g. PR) |

Also exported: `preparerRole`, `developerRole`, `submitterRole` and their Zod meta schemas, `SolveIssueMeta`, `solveIssueRoles`.

## Moderator flow

1. **Start** → `preparer`  
2. After **preparer** → `developer`  
3. After **developer** → `submitter`  
4. After **submitter** → `END`

## API overview

| Export | Description |
|--------|-------------|
| `createSolveIssueRun` | Merges `developer` override with `workflowAsAgent("develop")`, then `createWorkflow` |
| `solveIssueWorkflowDefinition` | `description`, `roles`, `solveIssueModerator` |
| `solveIssueModerator` | Linear `Moderator<SolveIssueMeta>` |
| `buildSolveIssueDescriptor` | Descriptor helper for bundles |
| `SOLVE_ISSUE_WORKFLOW_DESCRIPTION` | Human-readable one-liner |
