# @united-workforce/agent-hermes

`uwf-hermes` — an **agent adapter** that bridges the `uwf` workflow engine and the Hermes CLI.

## Overview

`uwf-hermes` is an adapter (not the Hermes CLI itself). The `uwf` engine speaks a generic agent protocol (stdin/stdout frontmatter contract); `uwf-hermes` translates that protocol into Hermes ACP (Agent Client Protocol) calls. Other adapters (e.g. `uwf-claude-code`, `uwf-cursor`) do the same for their respective CLIs.

On first visit to a role it sends a composed prompt (role definition, task, history, edge prompt); on continuation it resumes the cached session. Session transcripts and raw output are stored as CAS detail nodes.

**Dependencies:** `@ocas/core`, `@united-workforce/util-agent`, `@united-workforce/protocol`, `@united-workforce/util`

## Installation

Included as the `uwf-hermes` binary when you install `@united-workforce/agent-hermes`:

```bash
bun add -g @united-workforce/agent-hermes
```

Requires the `hermes` CLI on `PATH`.

Hermes must write session JSON snapshots so `uwf-hermes` can load structured tool calls from disk. Add this to `~/.hermes/config.yaml`:

```yaml
sessions:
  write_json_snapshots: true
```

Session files are stored at `~/.hermes/sessions/session_{sessionId}.json`.

## CLI Usage

Invoked by `uwf thread step` (not typically run directly):

```bash
uwf-hermes <thread-id> <role>
```

### Flags

| Flag | Description |
|------|-------------|
| `--timeout <seconds>` | Per-prompt ACP `session/prompt` timeout in seconds (positive integer). Overrides `UWF_HERMES_TIMEOUT`. Default: `600` (10 minutes). |
| `--version`, `-V` | Print the adapter version and exit. |

Invalid `--timeout` values (non-numeric, zero, negative, decimal) exit non-zero with the message `--timeout must be a positive integer (seconds); got: <value>`.

Environment variables set by the engine:

| Variable | Purpose |
|----------|---------|
| `UWF_EDGE_PROMPT` | Moderator edge instruction for this step |
| `UWF_HERMES_TIMEOUT` | Per-prompt timeout in seconds (positive integer). Fallback when `--timeout` is absent. Empty string falls through to the default. Invalid values cause `uwf-hermes` to exit non-zero with `UWF_HERMES_TIMEOUT must be a positive integer (seconds); got: <value>`. |
| `UWF_HERMES_BIN` | Override the `hermes` binary path (default resolves via `PATH`). |
| `UWF_HERMES_NO_RESUME` | Set to `1` to disable session resume (see `isResumeDisabled`). |

Priority for the prompt timeout: `--timeout` flag > `UWF_HERMES_TIMEOUT` env > default (600 seconds).

Configure as the default agent via `uwf setup --agent hermes`.

Override per step:

```bash
uwf thread step <thread-id> --agent uwf-hermes
```

Or extend the timeout for one long-running step (e.g. release publish that waits
on `proman publish` to register and push every package):

```bash
UWF_HERMES_TIMEOUT=1800 uwf thread step <thread-id> --agent uwf-hermes
# or
uwf thread step <thread-id> --agent "uwf-hermes --timeout 1800"
```

## API

All exports come from `src/index.ts`.

### Agent factory

```typescript
function createHermesAgent(
  resumeDisabled: boolean,
  promptTimeoutMs?: number,
): () => Promise<void>
function buildHermesPrompt(ctx: AgentContext): string
```

### ACP client

```typescript
class HermesAcpClient {
  // Spawns hermes, handles JSON-RPC over stdio
  constructor(promptTimeoutMs?: number) // defaults to DEFAULT_PROMPT_TIMEOUT_MS
}
```

### Timeout resolver

```typescript
const DEFAULT_PROMPT_TIMEOUT_MS: number // 10 * 60 * 1000

type ResolveTimeoutResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

function resolveHermesTimeoutMs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): ResolveTimeoutResult

function formatTimeoutSuspendMessage(timeoutMs: number): string
```

## Usage (library)

```typescript
import {
  createHermesAgent,
  buildHermesPrompt,
  resolveHermesTimeoutMs,
} from "@united-workforce/agent-hermes";

// CLI entry (src/cli.ts):
const timeout = resolveHermesTimeoutMs(process.argv.slice(2), process.env);
if (!timeout.ok) {
  process.stderr.write(`${timeout.error}\n`);
  process.exit(1);
}
const main = createHermesAgent(/* resumeDisabled */ false, timeout.value);
void main();
```

## Internal Structure

```
src/
├── index.ts
├── cli.ts              Binary entrypoint
├── hermes.ts           createHermesAgent, buildHermesPrompt
├── acp-client.ts       HermesAcpClient — ACP JSON-RPC over stdio
├── timeout.ts          resolveHermesTimeoutMs, DEFAULT_PROMPT_TIMEOUT_MS
├── session-cache.ts    Session ID cache (re-exports kit helpers + isResumeDisabled)
├── session-detail.ts   Parse Hermes session JSON, store CAS detail nodes
├── schemas.ts          Hermes detail CAS schemas
└── types.ts            HermesSessionJson, HermesSessionMessage
```

## Configuration

Uses workflow config from `~/.uwf/config.yaml` (via agent-kit). Hermes session files are stored under the workflow storage root (see `session-detail.ts`).

Set `UWF_HERMES_NO_RESUME=1` to disable session resume (see `isResumeDisabled` in `session-cache.ts`).
