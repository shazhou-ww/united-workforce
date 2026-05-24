# @uncaged/workflow-protocol

Shared TypeScript types and JSON Schema constants for the workflow engine.

## Overview

This is the contract layer (Layer 0). It defines `WorkflowPayload`, thread node payloads, moderator context, CLI output shapes, and configuration types used across every other package. It has no runtime logic beyond exporting schema objects from `@uncaged/json-cas`.

**Dependencies:** `@uncaged/json-cas`, `@uncaged/json-cas-fs`

## Installation

```bash
bun add @uncaged/workflow-protocol
```

## API

All exports come from `src/index.ts`.

### JSON Schema constants

```typescript
START_NODE_SCHEMA: JSONSchema
STEP_NODE_SCHEMA: JSONSchema
WORKFLOW_SCHEMA: JSONSchema
```

### Core identifiers

```typescript
type CasRef = string      // XXH64 hash, 13-char Crockford Base32
type ThreadId = string    // ULID, 26-char Crockford Base32
type WorkflowName = string
type RoleName = string
```

### Workflow definition

```typescript
type RoleDefinition = {
  description: string;
  goal: string;
  capabilities: string[];
  procedure: string;
  output: string;
  frontmatter: CasRef;
};

type Transition = {
  role: string;
  condition: string | null;
  prompt: string;
};

type ConditionDefinition = {
  description: string;
  expression: string;
};

type WorkflowPayload = {
  name: string;
  description: string;
  roles: Record<string, RoleDefinition>;
  conditions: Record<string, ConditionDefinition>;
  graph: Record<string, Transition[]>;
};
```

### Thread nodes

```typescript
type StepRecord = {
  role: string;
  output: CasRef;
  detail: CasRef;
  agent: string;
  edgePrompt: string;
};

type StartNodePayload = {
  workflow: CasRef;
  prompt: string;
};

type StepNodePayload = StepRecord & {
  start: CasRef;
  prev: CasRef | null;
};
```

### Moderator context

```typescript
type StepContext = Omit<StepRecord, "output"> & { output: unknown; content: string | null };

type ModeratorContext = {
  start: StartNodePayload;
  steps: StepContext[];
};
```

### Configuration

```typescript
type ProviderAlias = string;
type ModelAlias = string;
type AgentAlias = string;

type ProviderConfig = { baseUrl: string; apiKeyEnv: string };
type ModelConfig = {
  provider: ProviderAlias;
  name: string;
};

type AgentConfig = {
  command: string;
  args: string[];
};

type WorkflowConfig = {
  providers: Record<ProviderAlias, ProviderConfig>;
  models: Record<ModelAlias, ModelConfig>;
  agents: Record<AgentAlias, AgentConfig>;
  defaultAgent: AgentAlias;
  agentOverrides: Record<WorkflowName, Record<RoleName, AgentAlias>> | null;
  defaultModel: ModelAlias;
  modelOverrides: Record<Scenario, ModelAlias> | null;
};
```

### CLI output types

```typescript
type StartOutput = { workflow: CasRef; thread: ThreadId };

type StepOutput = {
  workflow: CasRef;
  thread: ThreadId;
  head: CasRef;
  done: boolean;
};

type StepEntry = {
  hash: CasRef;
  role: string;
  output: unknown;
  detail: CasRef;
  agent: string;
  timestamp: number;
};

type StartEntry = {
  hash: CasRef;
  workflow: CasRef;
  prompt: string;
  timestamp: number;
};

type ThreadStepsOutput = {
  thread: ThreadId;
  workflow: CasRef;
  steps: [StartEntry, ...StepEntry[]];
};

type ThreadForkOutput = {
  thread: ThreadId;
  forkedFrom: { step: CasRef };
};

type ThreadListItem = {
  thread: ThreadId;
  workflow: CasRef;
  head: CasRef;
};

type ThreadsIndex = Record<ThreadId, CasRef>;

type Scenario = string;
```

## Internal Structure

```
src/
├── index.ts      Public re-exports
├── types.ts      All type definitions
└── schemas.ts    START_NODE_SCHEMA, STEP_NODE_SCHEMA, WORKFLOW_SCHEMA
```

## Configuration

This package defines `WorkflowConfig` types only. Runtime config loading lives in `@uncaged/workflow-agent-kit` (`loadWorkflowConfig`).
