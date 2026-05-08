# @uncaged/workflow-template-develop

Reference **develop** workflow template: plan phases, implement in a loop, review, test, then commit.

Export a `WorkflowDefinition` and `createDevelopRun` so a host can bind agents/LLM and run the same graph the bundled `.esm.js` would use. Use `buildDevelopDescriptor()` when assembling `descriptor` metadata for a bundle.

## Install

```bash
bun add @uncaged/workflow-template-develop @uncaged/workflow zod
```

In this monorepo: `workspace:*` for `@uncaged/workflow-template-develop` and `@uncaged/workflow`.

## Usage

```typescript
import { createDevelopRun, developWorkflowDefinition } from "@uncaged/workflow-template-develop";

const run = createDevelopRun(binding, extract, llmProvider);
// run(...) executes the develop moderator graph with your AgentBinding
```

## Roles

| Role | Purpose |
|------|---------|
| **planner** | Break work into ordered phases (hashes) |
| **coder** | Implement current phase; repeats until phases complete or limits hit |
| **reviewer** | Code review gate (`approved` vs send back to coder) |
| **tester** | Verify via tests/build/lint (`passed` vs send back to coder) |
| **committer** | Final commit step |

Also exported: role factories/meta schemas (`plannerRole`, `coderRole`, …), `DevelopMeta`, `developRoles`.

## Moderator flow

1. **Start** → `planner`  
2. After **planner** → `coder`  
3. After **coder** → if all planned phases are done (or last phase completed) → `reviewer`; else `coder` again, until `maxRounds` then `END`  
4. After **reviewer** → if approved → `tester`; else `coder` (or `END` if out of rounds)  
5. After **tester** → if passed → `committer`; else `coder` (or `END` if out of rounds)  
6. After **committer** → `END`

## API overview

| Export | Description |
|--------|-------------|
| `createDevelopRun` | `createWorkflow(developWorkflowDefinition, …)` factory |
| `developWorkflowDefinition` | `description`, `roles`, `developModerator` |
| `developModerator` | `Moderator<DevelopMeta>` |
| `buildDevelopDescriptor` | `buildDescriptor({ … })` for bundle metadata |
| `DEVELOP_WORKFLOW_DESCRIPTION` | Human-readable one-liner |
