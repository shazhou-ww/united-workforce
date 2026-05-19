# @uncaged/workflow-template-solve-issue

Reference **solve-issue** workflow template: prepare a repo, delegate implementation to the **develop** workflow, then submit (e.g. open a PR).

This package exports a pure `WorkflowDefinition` (`solveIssueWorkflowDefinition`). Workflow instantiation (`createWorkflow(definition, binding)`) and any role-specific agent wiring (for example delegating `developer` to `workflowAsAgent("develop")`) are done in the workflow instance layer.

## Install

```bash
bun add @uncaged/workflow-template-solve-issue @uncaged/workflow zod
```

In this monorepo: `workspace:*` for this package and `@uncaged/workflow`.

## Usage

```typescript
import { createWorkflow } from "@uncaged/workflow";
import { solveIssueWorkflowDefinition } from "@uncaged/workflow-template-solve-issue";

const run = createWorkflow(solveIssueWorkflowDefinition, binding);
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
| `solveIssueWorkflowDefinition` | `description`, `roles`, `solveIssueModerator` |
| `solveIssueModerator` | Linear `Moderator<SolveIssueMeta>` |
| `buildSolveIssueDescriptor` | Descriptor helper for bundles |
| `SOLVE_ISSUE_WORKFLOW_DESCRIPTION` | Human-readable one-liner |
