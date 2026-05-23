# @uncaged/workflow-agent-kit

Agent framework — `createAgent` factory, context builder, frontmatter fast-path, and LLM extract pipeline.

## Overview

Layer 2 agent framework. Provides the standard entrypoint for all agent CLIs: parse `<thread-id> <role>` from argv, load thread/workflow context from CAS, invoke the agent's `run`/`continue` functions, validate output via frontmatter fast-path or LLM extract, and write a `StepNodePayload` to CAS.

Also exports prompt builders, config/storage helpers, and session ID caching for multi-turn agents.

**Dependencies:** `@uncaged/json-cas`, `@uncaged/json-cas-fs`, `@uncaged/workflow-protocol`, `@uncaged/workflow-util`, `dotenv`, `yaml`

## Installation

```bash
bun add @uncaged/workflow-agent-kit
```

## API

All exports come from `src/index.ts`.

### Agent factory

```typescript
function createAgent(options: AgentOptions): () => Promise<void>

type AgentOptions = {
  name: string;
  run: AgentRunFn;
  continue: AgentContinueFn;
};

type AgentRunFn = (ctx: AgentContext) => Promise<AgentRunResult>;
type AgentContinueFn = (
  sessionId: string,
  message: string,
  store: AgentContext["store"],
) => Promise<AgentRunResult>;

type AgentRunResult = {
  output: string;
  detailHash: string;
  sessionId: string;
};
```

Agent CLIs call `createAgent(...)` and invoke the returned function as `main()`.

### Context

```typescript
function buildContext(threadId: ThreadId, role: string): Promise<AgentContext>
function buildContextWithMeta(
  threadId: ThreadId,
  role: string,
): Promise<AgentContext & { meta: BuildContextMeta }>

type AgentContext = ModeratorContext & {
  threadId: ThreadId;
  role: string;
  store: Store;
  workflow: WorkflowPayload;
  outputFormatInstruction: string;
  edgePrompt: string;
  isFirstVisit: boolean;
};

type BuildContextMeta = {
  storageRoot: string;
  store: Store;
  schemas: AgentStore["schemas"];
  headHash: CasRef;
  chain: ChainState;
};
```

Requires `UWF_EDGE_PROMPT` in the environment (set by `uwf thread step`).

### Prompt builders

```typescript
function buildRolePrompt(role: RoleDefinition): string
function buildOutputFormatInstruction(schema: JSONSchema): string
function buildContinuationPrompt(
  ctx: AgentContext,
  priorOutput: string,
  instruction: string,
): string
```

### Extract pipeline

```typescript
function resolveExtractModelAlias(config: WorkflowConfig): ModelAlias
function resolveModel(config: WorkflowConfig, alias: ModelAlias): ResolvedLlmProvider
function extract(
  rawOutput: string,
  outputSchema: CasRef,
  config: WorkflowConfig,
): Promise<ExtractResult>

type ResolvedLlmProvider = { baseUrl: string; apiKey: string; model: string };
type ExtractResult = { value: unknown; hash: CasRef };
```

### Frontmatter fast-path

```typescript
function tryFrontmatterFastPath(
  rawOutput: string,
  outputSchema: CasRef,
  store: Store,
): Promise<FrontmatterFastPathResult | null>

type FrontmatterFastPathResult = { body: string; outputHash: CasRef };
```

### Session cache

```typescript
function getCachedSessionId(threadId: ThreadId, role: string): Promise<string | null>
function setCachedSessionId(
  threadId: ThreadId,
  role: string,
  sessionId: string,
): Promise<void>
```

### Config and storage

```typescript
function getConfigPath(storageRoot: string): string
function getEnvPath(storageRoot: string): string
function resolveStorageRoot(): string
function loadWorkflowConfig(storageRoot: string): Promise<WorkflowConfig>
```

## Usage

```typescript
import { createAgent, buildRolePrompt } from "@uncaged/workflow-agent-kit";
import type { AgentContext, AgentRunResult } from "@uncaged/workflow-agent-kit";

async function run(ctx: AgentContext): Promise<AgentRunResult> {
  const prompt = buildRolePrompt(ctx.workflow.roles[ctx.role]!);
  // ... spawn external process, capture output ...
  return { output: markdown, detailHash: "...", sessionId: "..." };
}

async function continueSession(
  sessionId: string,
  message: string,
): Promise<AgentRunResult> {
  // ... continue multi-turn session ...
  return { output: markdown, detailHash: "...", sessionId };
}

export const main = createAgent({ name: "my-agent", run, continue: continueSession });
```

## Internal Structure

```
src/
├── index.ts
├── run.ts                         createAgent entrypoint
├── context.ts                     Thread chain walk, AgentContext builder
├── extract.ts                     LLM structured extract fallback
├── frontmatter.ts                 Frontmatter fast-path validation
├── build-role-prompt.ts           Role definition → prompt text
├── build-output-format-instruction.ts
├── build-continuation-prompt.ts
├── session-cache.ts               Per-thread/session ID persistence
├── storage.ts                     CAS store, config, threads index
├── schemas.ts                     Agent CAS schema registration
└── types.ts                       AgentContext, AgentOptions, etc.
```

## Configuration

Reads `config.yaml` and `.env` from the workflow storage root (`~/.uncaged/workflow` by default). See `@uncaged/workflow-protocol` for `WorkflowConfig` shape. Set via `uwf setup`.
