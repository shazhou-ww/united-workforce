# @uncaged/workflow-runtime

Workflow author API: `createWorkflow` plus re-exports of protocol workflow types.

## What This Package Does

Bundle code imports `createWorkflow` to turn a `WorkflowDefinition` plus `AgentBinding` into a `WorkflowFn` generator. It re-exports the protocol types and constants most authors need so workflows rarely import `@uncaged/workflow-protocol` directly.

## Key Exports

From `src/index.ts`:

- **Functions:** `createWorkflow`, `ok`, `err`
- **Types:** `AgentBinding`, `AgentContext`, `AgentFn`, `CasStore`, `ExtractContext`, `ExtractFn`, `LlmProvider`, `Moderator`, `ModeratorContext`, `Result`, `RoleDefinition`, `RoleMeta`, `RoleOutput`, `RoleStep`, `StartStep`, `ThreadContext`, `WorkflowCompletion`, `WorkflowDefinition`, `WorkflowDescriptor`, `WorkflowFn`, `WorkflowResult`, `WorkflowRoleDescriptor`, `WorkflowRoleSchema`, `WorkflowRuntime`
- **Constants:** `END`, `START`

## Dependencies

- **Workspace:** `@uncaged/workflow-protocol` — contract types and helpers
- **Peer:** `zod` ^4 — matches schema usage on role definitions

## Usage

```typescript
import { createWorkflow, type WorkflowDefinition, type AgentBinding } from "@uncaged/workflow-runtime";

export const run = createWorkflow(myDefinition, myBinding);
```
