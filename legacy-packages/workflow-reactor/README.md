# @uncaged/workflow-reactor

LLM calling abstraction and thread “reactor” for structured tool invocation.

## What This Package Does

It exposes `createLlmFn` (chat completion wrapper) and `createThreadReactor` (multi-turn tool loop configuration) plus supporting message/tool types. `@uncaged/workflow-execute` consumes this for extractor and supervisor paths that talk to OpenAI-style APIs with tools.

## Key Exports

From `src/index.ts`:

- **Functions:** `createLlmFn`, `createThreadReactor`
- **Types:** `ChatMessage`, `LlmFn`, `StructuredToolSpec`, `ThreadReactorConfig`, `ThreadReactorFn`, `ThreadReactorInvokeArgs`, `ToolCall`, `ToolDefinition`

## Dependencies

- **Workspace:** `@uncaged/workflow-protocol`
- **Peer:** `zod` ^4

## Usage

```typescript
import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
// Usually composed inside @uncaged/workflow-execute rather than directly by applications.
```
