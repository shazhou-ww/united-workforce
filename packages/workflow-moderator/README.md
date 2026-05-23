# @uncaged/workflow-moderator

JSONata-based graph evaluator — determines the next role or `$END` with zero LLM cost.

## Overview

The moderator (Layer 1) walks the workflow graph from the current role. For each outgoing transition it evaluates an optional JSONata condition against `ModeratorContext` (start prompt + prior step outputs). The first truthy transition wins; its target role and edge prompt are returned. When no transition matches, the workflow ends (`$END`).

**Dependencies:** `@uncaged/workflow-protocol`, `jsonata`

## Installation

```bash
bun add @uncaged/workflow-moderator
```

## API

### Functions

```typescript
function evaluate(
  workflow: WorkflowPayload,
  context: ModeratorContext,
): Promise<Result<EvaluateResult, Error>>
```

Returns `{ ok: true, value: { role, prompt } }` where `role` is the next role name or `"$END"`, and `prompt` is the edge instruction for the agent.

### Types

```typescript
type EvaluateResult = {
  role: string;
  prompt: string;
};
```

The `Result<T, E>` type is local to this package (`{ ok: true; value: T } | { ok: false; error: E }`), not re-exported from `index.ts`.

## Usage

```typescript
import { evaluate } from "@uncaged/workflow-moderator";
import type { ModeratorContext, WorkflowPayload } from "@uncaged/workflow-protocol";

const result = await evaluate(workflow, context);
if (result.ok && result.value.role !== "$END") {
  console.log(`Next role: ${result.value.role}, prompt: ${result.value.prompt}`);
}
```

## Internal Structure

```
src/
├── index.ts      Public exports
├── evaluate.ts   Graph walk + JSONata condition evaluation
└── types.ts      EvaluateResult, Result
```
