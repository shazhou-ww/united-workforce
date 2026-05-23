# @uncaged/workflow-agent-hermes

`uwf-hermes` agent — spawns Hermes chat via ACP and captures session detail.

## Overview

Layer 3 agent implementation. Wraps the Hermes CLI using the Agent Client Protocol (ACP). On first visit to a role it sends a composed prompt (role definition, task, history, edge prompt); on continuation it resumes the cached session. Session transcripts and raw output are stored as CAS detail nodes.

**Dependencies:** `@uncaged/json-cas`, `@uncaged/workflow-agent-kit`, `@uncaged/workflow-protocol`, `@uncaged/workflow-util`

## Installation

Included as the `uwf-hermes` binary when you install `@uncaged/workflow-agent-hermes`:

```bash
bun add -g @uncaged/workflow-agent-hermes
```

Requires the `hermes` CLI on `PATH`.

## CLI Usage

Invoked by `uwf thread step` (not typically run directly):

```bash
uwf-hermes <thread-id> <role>
```

Environment variables set by the engine:

| Variable | Purpose |
|----------|---------|
| `UWF_EDGE_PROMPT` | Moderator edge instruction for this step |

Configure as the default agent via `uwf setup --agent hermes`.

Override per step:

```bash
uwf thread step <thread-id> --agent uwf-hermes
```

## API

All exports come from `src/index.ts`.

### Agent factory

```typescript
function createHermesAgent(): () => Promise<void>
function buildHermesPrompt(ctx: AgentContext): string
```

### ACP client

```typescript
class HermesAcpClient {
  // Spawns hermes, handles JSON-RPC over stdio
}
```

## Usage (library)

```typescript
import { createHermesAgent, buildHermesPrompt } from "@uncaged/workflow-agent-hermes";

// CLI entry (src/cli.ts):
const main = createHermesAgent();
void main();
```

## Internal Structure

```
src/
├── index.ts
├── cli.ts              Binary entrypoint
├── hermes.ts           createHermesAgent, buildHermesPrompt
├── acp-client.ts       HermesAcpClient — ACP JSON-RPC over stdio
├── session-cache.ts    Session ID cache (re-exports kit helpers + isResumeDisabled)
├── session-detail.ts   Parse Hermes session JSON, store CAS detail nodes
├── schemas.ts          Hermes detail CAS schemas
└── types.ts            HermesSessionJson, HermesSessionMessage
```

## Configuration

Uses workflow config from `~/.uncaged/workflow/config.yaml` (via agent-kit). Hermes session files are stored under the workflow storage root (see `session-detail.ts`).

Set `UWF_HERMES_NO_RESUME=1` to disable session resume (see `isResumeDisabled` in `session-cache.ts`).
