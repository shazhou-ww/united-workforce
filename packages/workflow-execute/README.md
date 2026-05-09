# @uncaged/workflow-execute

Thread engine: execution, fork/GC, extract pipeline, supervisor/worker wiring, and workflow-as-agent.

## What This Package Does

It runs `WorkflowFn` generators against disk-backed threads, integrates CAS and registry-backed extract (`createExtract`), coordinates LLM tool usage via `@uncaged/workflow-reactor`, handles fork plans and garbage collection, and exposes `workflowAsAgent` for nesting workflows.

## Key Exports

From `src/index.ts`:

- **Engine:** `createWorkflow` (engine-local re-export), `executeThread`, `getWorkerHostScriptPath`
- **Fork / parse:** `buildForkPlan`, `parseThreadDataJsonl`, `selectForkHistoricalSteps`, `tryParseRoleStepRecord`, `tryParseWorkflowResultRecord`
- **GC / pause:** `garbageCollectCas`, `createThreadPauseGate`
- **Engine types:** `ExecuteThreadIo`, `ExecuteThreadOptions`, `ForkHistoricalStep`, `ForkPlan`, `GcResult`, `ParsedThreadStartRecord`, `PrefilledDiskStep`, `SupervisorDecision`, `ThreadPauseGate`
- **Extract:** `buildExtractUserContent`, `createExtract`, `extractFunctionToolFromZodSchema`, `llmErrorToCause`, `llmExtract`, types `ExtractFn`, `ExtractThreadContext`, `LlmError`, `LlmExtractArgs`
- **Agent composition:** `workflowAsAgent`, `WorkflowAsAgentOptions`

## Dependencies

- **Workspace:** `@uncaged/workflow-protocol`, `@uncaged/workflow-runtime`, `@uncaged/workflow-util`, `@uncaged/workflow-cas`, `@uncaged/workflow-reactor`, `@uncaged/workflow-register`
- **npm:** `yaml`
- **Peer:** `zod` ^4

`@uncaged/workflow-reactor` is used for LLM-backed extract and supervisor flows (`extract-fn.ts`, `supervisor.ts`).

## Usage

```typescript
import { executeThread } from "@uncaged/workflow-execute";
// Typical callers are CLI/tests that supply ExecuteThreadIo (paths, CAS, abort, logger, …).
```
