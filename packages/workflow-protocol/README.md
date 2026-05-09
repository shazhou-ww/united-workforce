# @uncaged/workflow-protocol

Shared workflow types, sentinel constants, and `Result` helpers.

## What This Package Does

It defines the cross-package contract for bundles and the engine: thread/step shapes, `WorkflowFn`, agent/extract contexts, descriptor types, and `CasStore` as an interface. Implementations (CAS store, CLI, extract) depend on these types so bundles stay decoupled from Node APIs.

## Key Exports

From `src/index.ts`:

- **Types:** `Result`, `CasStore`, `WorkflowRoleSchema`, `WorkflowRoleDescriptor`, `WorkflowDescriptor`, `RoleMeta`, `RoleOutput`, `StartStep`, `RoleStep`, `ThreadContext`, `ModeratorContext`, `AgentContext`, `ExtractContext`, `WorkflowCompletion`, `WorkflowResult`, `LlmProvider`, `ProviderConfig`, `ResolvedModel`, `WorkflowConfig`, `ExtractFn`, `AgentFn`, `AgentBinding`, `WorkflowRuntime`, `WorkflowFn`, `RoleDefinition`, `Moderator`, `WorkflowDefinition`, `AdvanceOutcome`
- **Constants:** `START`, `END`
- **Functions:** `ok`, `err`

## Dependencies

- **Peer:** `zod` ^4 — used in type positions for schemas (`ExtractFn`, `RoleDefinition`, etc.)

No workspace packages; this is the bottom layer.

## Usage

```typescript
import { END, START, type WorkflowFn, type ThreadContext } from "@uncaged/workflow-protocol";
```

Concrete `WorkflowFn` implementations are built with `@uncaged/workflow-runtime` (`createWorkflow`).
