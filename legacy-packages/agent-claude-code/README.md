# @united-workforce/agent-claude-code

> **⚠️ Archived (Phase 4 cleanup, #381):** This package is no longer
> published. It has been superseded by [`@united-workforce/broker`](../../packages/broker),
> the Sumeru gateway client used by the `uwf` CLI for all out-of-process
> agent integrations. Source preserved here for historical reference only.

`uwf-claude-code` agent — spawns the Claude Code CLI and captures session detail.

## Overview

Layer 3 agent implementation. Spawns the `claude` CLI with a composed system prompt (role definition, task, prior steps, edge prompt). Parses stream or JSON stdout, caches session IDs for multi-turn continuation, and stores raw output plus structured detail in CAS.

**Dependencies:** `@ocas/core`, `@united-workforce/util-agent`

## Installation

Included as the `uwf-claude-code` binary when you install `@united-workforce/agent-claude-code`:

```bash
bun add -g @united-workforce/agent-claude-code
```

Requires the `claude` CLI on `PATH`.

## CLI Usage

Invoked by `uwf thread step`:

```bash
uwf-claude-code <thread-id> <role>
```

Configure or override the agent:

```bash
uwf setup --agent claude-code
uwf thread step <thread-id> --agent uwf-claude-code
```

Environment variables set by the engine:

| Variable | Purpose |
|----------|---------|
| `UWF_EDGE_PROMPT` | Moderator edge instruction for this step |

## API

All exports come from `src/index.ts`.

### Agent factory

```typescript
function createClaudeCodeAgent(): () => Promise<void>
function buildClaudeCodePrompt(ctx: AgentContext): string
```

### Session detail

```typescript
function parseClaudeCodeStreamOutput(stdout: string): ClaudeCodeParsedResult | null
function parseClaudeCodeJsonOutput(stdout: string): ClaudeCodeParsedResult | null
function storeClaudeCodeDetail(
  store: Store,
  parsed: ClaudeCodeParsedResult,
  sessionId: string,
): Promise<string>
function storeClaudeCodeRawOutput(store: Store, rawOutput: string): Promise<string>
```

## Usage (library)

```typescript
import { createClaudeCodeAgent, buildClaudeCodePrompt } from "@united-workforce/agent-claude-code";

const main = createClaudeCodeAgent();
void main();
```

## Internal Structure

```
src/
├── index.ts
├── cli.ts              Binary entrypoint
├── claude-code.ts      createClaudeCodeAgent, buildClaudeCodePrompt, spawn logic
├── session-detail.ts   Parse stdout, store CAS detail nodes
├── schemas.ts          Claude Code detail CAS schemas
└── types.ts            ClaudeCodeParsedResult, message shapes
```

## Configuration

Uses session caching from `@united-workforce/util-agent` (`getCachedSessionId` / `setCachedSessionId`). No separate config file — relies on the Claude Code CLI's own authentication.

Maximum turns per invocation: 90 (constant in `claude-code.ts`).
