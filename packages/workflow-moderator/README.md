# @uncaged/workflow-moderator

Status-based graph evaluator — determines the next role or `$END` with zero LLM cost.

## Overview

The moderator (Layer 1) performs a status-based map lookup on the workflow graph. Given the last role and its output, it looks up `graph[lastRole][lastOutput.status]` to find the next `Target` (role + prompt template). The prompt is rendered via Mustache with `lastOutput` as the template context. For `$START`, the unit status `_` is used.

**Dependencies:** `@uncaged/workflow-protocol`, `mustache`

## Installation

```bash
bun add @uncaged/workflow-moderator
```

## API

### Functions

```typescript
function evaluate(
  graph: Record<string, Record<string, Target>>,
  lastRole: string,
  lastOutput: Record<string, unknown> & { status: string },
): Result<EvaluateResult, Error>
```

Returns `{ ok: true, value: { role, prompt } }` where `role` is the next role name or `"$END"`, and `prompt` is the rendered edge instruction for the agent.

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
import type { Target } from "@uncaged/workflow-protocol";

const result = evaluate(graph, lastRole, lastOutput);
if (result.ok && result.value.role !== "$END") {
  console.log(`Next role: ${result.value.role}, prompt: ${result.value.prompt}`);
}
```

## Internal Structure

```
src/
├── index.ts      Public exports
├── evaluate.ts   Status-based map lookup + Mustache prompt rendering
└── types.ts      EvaluateResult, Result
```
