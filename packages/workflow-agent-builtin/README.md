# @uncaged/workflow-agent-builtin

`uwf-builtin` agent — built-in LLM agent with file read/write and shell tools.

## Overview

Layer 3 agent implementation. Runs an OpenAI-compatible chat completion loop with built-in tools (`read_file`, `write_file`, `run_command`). Uses the configured provider/model from `config.yaml`. Produces frontmatter markdown output and stores turn-by-turn session detail in CAS.

Useful when you want a self-contained agent without an external CLI like Hermes or Claude Code.

**Dependencies:** `@uncaged/json-cas`, `@uncaged/workflow-agent-kit`, `@uncaged/workflow-util`

## Installation

Included as the `uwf-builtin` binary when you install `@uncaged/workflow-agent-builtin`:

```bash
bun add -g @uncaged/workflow-agent-builtin
```

## CLI Usage

Invoked by `uwf thread step`:

```bash
uwf-builtin <thread-id> <role>
```

Configure as default agent:

```bash
uwf setup --agent builtin
```

Override per step:

```bash
uwf thread step <thread-id> --agent uwf-builtin
```

Environment variables set by the engine:

| Variable | Purpose |
|----------|---------|
| `UWF_EDGE_PROMPT` | Moderator edge instruction for this step |

## API

All exports come from `src/index.ts`.

### Agent factory

```typescript
function createBuiltinAgent(): () => Promise<void>
function buildBuiltinMessages(ctx: AgentContext): ChatMessage[]
```

### LLM loop

```typescript
const BUILTIN_MAX_TURNS = 30;
const BUILTIN_CONTINUE_MAX_TURNS = 5;

function runBuiltinLoop(/* options: RunBuiltinLoopOptions */): Promise<RunBuiltinLoopResult>
function chatCompletionWithTools(
  provider: ResolvedLlmProvider,
  messages: ChatMessage[],
  tools: OpenAiToolDefinition[],
): Promise<LlmAssistantResponse>
```

`RunBuiltinLoopOptions` and `RunBuiltinLoopResult` are internal to `loop.ts` and not re-exported from `index.ts`.

### Tools

```typescript
function getBuiltinTools(): readonly BuiltinTool[]
function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string>
```

### Session and detail

```typescript
function initSessionDir(storageRoot: string): Promise<void>
function appendSessionTurn(storageRoot: string, sessionId: string, turn: BuiltinTurnPayload): Promise<void>
function readSessionTurns(storageRoot: string, sessionId: string): Promise<BuiltinTurnPayload[]>
function removeSession(storageRoot: string, sessionId: string): Promise<void>
function registerBuiltinSchemas(store: Store): Promise<BuiltinSchemaHashes>
function storeBuiltinDetail(store: Store, payload: BuiltinDetailPayload): Promise<string>
```

### Types

```typescript
type ChatMessage = /* system | user | assistant | tool */;
type LlmAssistantResponse = { content: string | null; toolCalls: LlmToolCall[] | null };
type LlmToolCall = { id: string; name: string; arguments: string };
type BuiltinTool = { name: string; description: string; parameters: Record<string, unknown> };
type ToolContext = { cwd: string; storageRoot: string };
type BuiltinDetailPayload = { /* session turns, model, timestamps */ };
type BuiltinLoopTurn = { /* single loop iteration record */ };
type BuiltinToolCallRecord = { /* tool call audit */ };
type BuiltinToolResultRecord = { /* tool result audit */ };
type BuiltinTurnPayload = { /* persisted turn */ };
```

## Internal Structure

```
src/
├── index.ts
├── cli.ts              Binary entrypoint
├── agent.ts            createBuiltinAgent
├── loop.ts             Multi-turn LLM + tool loop
├── prompt.ts           buildBuiltinMessages
├── session.ts          Session directory persistence
├── detail.ts           CAS detail node storage
├── schemas.ts          Builtin CAS schemas
├── types.ts            Detail and turn payload types
├── llm/
│   ├── index.ts
│   ├── llm.ts          chatCompletionWithTools
│   └── types.ts        ChatMessage, LlmToolCall, etc.
└── tools/
    ├── index.ts        getBuiltinTools, executeBuiltinTool
    ├── read-file.ts
    ├── write-file.ts
    ├── run-command.ts
    ├── path.ts
    └── types.ts
```

## Configuration

Requires a configured OpenAI-compatible provider and model in `~/.uncaged/workflow/config.yaml` (via `uwf setup`). API keys are loaded from `~/.uncaged/workflow/.env`.

Tools run with the current working directory as `ToolContext.cwd` (typically the directory where `uwf thread step` was invoked).
