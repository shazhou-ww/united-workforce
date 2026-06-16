# @united-workforce/cli

`uwf` CLI — thread lifecycle, workflow registry, CAS inspection, and setup.

## Overview

Layer 4 entry point for the workflow engine. The `uwf` binary orchestrates one step per invocation: load the thread head, run the moderator, dispatch the role to the configured agent **over the Sumeru HTTP API via the broker** (`broker.send()`), run frontmatter extraction on the agent's reply, append a CAS step node, and update the head pointer (or archive when `$END`). Agents are no longer spawned as CLI subprocesses — `~/.uwf/config.yaml` declares an `agents` map keyed by alias, where each entry resolves to a `{host, gateway}` Sumeru endpoint that the broker contacts directly.

### Four-Layer Architecture

```
workflow → thread → step → turn
模板定义   执行实例   单步结果   agent内部交互
```

- **Workflow** (layer 1): YAML template with roles and routing graph
- **Thread** (layer 2): Single workflow execution instance
- **Step** (layer 3): One moderator→agent→extract cycle
- **Turn** (layer 4): Agent-internal interactions (use `step turns` to see the whole-thread turn panorama — every step's turns, with the in-flight step marked 进行中 — or `step show` / CAS to inspect)

This package has no library `src/index.ts` — it is consumed as a CLI binary only.

**Dependencies:** `@ocas/core`, `@ocas/fs`, `@united-workforce/util-agent`, `@united-workforce/protocol`, `@united-workforce/util`, `commander`, `dotenv`, `mustache`, `yaml`

## Installation

Included as the `uwf` binary when you install `@united-workforce/cli`:

```bash
bun add -g @united-workforce/cli
# or from the monorepo:
bun link packages/cli
```

## CLI Usage

### Global options

```
-V, --version                                       Show version
--format <text|json|yaml|raw-json|raw-yaml>         Output format (default: text)
-h, --help                                          Show help
```

### Output formats

| Format | Shape | Use case |
|--------|-------|----------|
| `text` (default) | Liquid-rendered, human-readable | Interactive terminal use |
| `json` | `{"type": "<schemaHash>", "value": <payload>}` | Self-describing JSON |
| `yaml` | YAML envelope with `type` and `value` keys | Self-describing YAML |
| `raw-json` | bare `<payload>` (no envelope) | 0.5.0-compatible JSON |
| `raw-yaml` | bare `<payload>` (no envelope) | 0.5.0-compatible YAML |

The `text` format renders each command's output through a Liquid template registered at `@ocas/template/text/<schemaHash>`, where `<schemaHash>` is the CAS hash of the corresponding `@uwf/output/<name>` schema (e.g. `@uwf/output/thread-start`, `@uwf/output/validate-result`). Schemas and templates are registered idempotently on first use.

The `json` and `yaml` envelopes carry the schema hash on the `type` field so consumers can dispatch on schema (and validate against the registered schema in CAS).

### Thread (Layer 2: Execution Instances)

| Command | Description |
|---------|-------------|
| `uwf thread start <workflow> -p <prompt>` | Create a thread without executing |
| `uwf thread exec <thread-id> [--agent <cmd>] [-c <count>] [--background]` | Execute one or more moderator→agent→extract cycles |
| `uwf thread show <thread-id>` | Show thread head pointer |
| `uwf thread list [--status <status>] [--all] [--after <date>] [--before <date>] [--skip <n>] [--take <n>]` | List threads (defaults to active: idle + running). Use `--all` to include end/cancelled/suspended, or `--status` to filter explicitly (idle, running, suspended, end, cancelled, active, or comma-separated). Supports time range and pagination. |
| `uwf thread read <thread-id> [--quota N] [--before <hash>] [--start]` | Render thread as readable markdown |

`thread read`, `step list`, and `step show` work on both active and ended threads.
| `uwf thread stop <thread-id>` | Stop background execution (keep thread active) |
| `uwf thread resume <thread-id> [-p <text>] [--agent <cmd>]` | Resume a suspended thread and re-run the suspended role |
| `uwf thread poke <thread-id> -p <text> [--agent <cmd>] [-c <count>]` | Re-run the head step's agent with a supplementary prompt (replaces head step) |
| `uwf thread cancel <thread-id>` | Cancel thread (stop + archive to history) |

### Suspend / Resume

When an agent emits `$status: "$SUSPEND"` in its frontmatter, the thread enters `suspended` status. A suspended thread **cannot be advanced with `exec`** — `exec` will detect the suspended head and return immediately without running any agent.

To continue a suspended thread, use `resume`:

```bash
uwf thread resume <thread-id>                    # resume with workflow's default prompt
uwf thread resume <thread-id> -p "version 1.2.0" # resume with supplementary context
```

> ⚠️ `exec` does not advance suspended threads — you **must** use `resume` to provide context and continue.

Examples:

```bash
uwf thread start solve-issue -p "Fix the login redirect bug"
uwf thread exec 01ARZ3NDEKTSV4RRFFQ69G5FAV
uwf thread exec 01ARZ3NDEKTSV4RRFFQ69G5FAV -c 3 --agent uwf-builtin
uwf thread exec 01ARZ3NDEKTSV4RRFFQ69G5FAV --background
uwf thread list
uwf thread list --all
uwf thread list --status running
uwf thread list --status active
uwf thread list --status idle,end
uwf thread list --after 7d --take 10
uwf thread read 01ARZ3NDEKTSV4RRFFQ69G5FAV --quota 8000
uwf thread stop 01ARZ3NDEKTSV4RRFFQ69G5FAV
```

### Step (Layer 3: Single Cycle Results)

| Command | Description |
|---------|-------------|
| `uwf step list <thread-id>` | List all steps in a thread chronologically |
| `uwf step show <step-hash>` | Show step metadata and frontmatter |
| `uwf step read <step-hash> [--quota <chars>]` | Read a step's turns as human-readable markdown |
| `uwf step turns <thread-id> [--role <r>] [--live] [--limit <n>] [--offset <m>]` | Show **all** turns across a thread's steps (whole-chain panorama): each completed step from its `detail.turns` (`✓`), the in-flight step from its active var (`🔄 进行中`) |
| `uwf step fork <step-hash>` | Fork a thread from a specific step |
| `uwf step ask <step-hash> -p <prompt> [--agent <cmd>] [--no-fork]` | Ask a follow-up question to a historical step's agent (read-only; no thread mutation) |

Examples:

```bash
uwf step list 01ARZ3NDEKTSV4RRFFQ69G5FAV
uwf step show 32GCDE899RRQ3
uwf step read 32GCDE899RRQ3 --quota 2000
uwf step turns 01ARZ3NDEKTSV4RRFFQ69G5FAV                    # whole-thread panorama
uwf step turns 01ARZ3NDEKTSV4RRFFQ69G5FAV --role coder       # filter to one role's steps
uwf step turns 01ARZ3NDEKTSV4RRFFQ69G5FAV --limit 20 --offset 40   # paginate the flat sequence
uwf step turns 01ARZ3NDEKTSV4RRFFQ69G5FAV --role coder --live      # follow the in-flight step
uwf step fork 32GCDE899RRQ3
uwf step ask 32GCDE899RRQ3 -p "Why did you choose this approach?"
uwf step ask 32GCDE899RRQ3 -p "Summarise the key findings" --no-fork
```

`step turns` is the turn-layer (layer 4) query keyed by `<thread-id>`. Unlike
`step read` — which renders a *single* completed step's `detail.turns` by step
hash, quota-bounded — `step turns` renders the **whole-thread turn panorama**: it
walks the entire thread chain and shows **every** step's turns in chronological
order, each turn attributed to its owning role/step. Completed steps are read from
their immutable `detail.turns` and marked `✓`; the in-flight step is read live from
its `@uwf/active-turns/<thread-id>/<role>` var and marked `🔄 进行中`. **All turns
show by default** (no truncation); `--limit`/`--offset` paginate the flattened
cross-step turn sequence. `--role <r>` filters the panorama to one role's steps
across the whole chain (e.g. on a multi-step thread whose head is a different role,
`--role developer` still returns the developer step's turns). With `--live` it polls
the SQLite-backed active var (not SSE) and prints each new turn as it arrives,
exiting when the in-flight step completes.

### Workflow (Layer 1: Templates)

| Command | Description |
|---------|-------------|
| `uwf workflow add <file.yaml>` | Register a workflow from YAML |
| `uwf workflow validate <file.yaml>` | Validate a workflow YAML without registering it (CI-friendly) |
| `uwf workflow show <name-or-hash>` | Show workflow definition |
| `uwf workflow list` | List registered workflows |

### CAS

Use the [`ocas`](https://www.npmjs.com/package/@ocas/cli) CLI for direct CAS operations (`~/.ocas/` store, shared with `uwf`):

| Command | Description |
|---------|-------------|
| `ocas get <hash> [--timestamp]` | Read a CAS node |
| `ocas put <type-hash> <data>` | Store a node, print hash |
| `ocas has <hash>` | Check existence |
| `ocas refs <hash>` | List direct references |
| `ocas walk <hash>` | Recursive traversal |
| `ocas reindex` | Rebuild type index |
| `ocas schema list` | List registered schemas |
| `ocas schema get <hash>` | Show a schema |

### Setup

```bash
uwf setup                    # interactive: pick the default agent adapter
uwf setup --agent hermes     # non-interactive: set default agent only
```

Engine config: `~/.uwf/config.yaml` (LLM-free — only `agents`, `defaultAgent`,
`agentOverrides`). Each agent adapter owns its own LLM config in
`~/.uwf/agents/<adapter>.yaml`.

### Skill

| Command | Description |
|---------|-------------|
| `uwf skill cli` | Print markdown reference of all uwf commands (for agent skills) |

### Log

| Command | Description |
|---------|-------------|
| `uwf log list` | List log files with sizes |
| `uwf log show [--thread <id>] [--process <pid>] [--date YYYY-MM-DD]` | Show filtered log entries |
| `uwf log clean [--before YYYY-MM-DD]` | Delete old log files |

## Migration Guide

### Breaking Changes (Phase 3 / #380) — broker integration & `{host, gateway}` agents

Phase 3 of the broker rollout removes the legacy `spawnAgent` /
`executeAgentCommand` / last-stdout-line JSON path from `uwf thread exec`.
The CLI now calls `broker.send({ threadId, role, prompt })` against the
Sumeru HTTP API and runs frontmatter extraction on the broker's
`result.output`. The CLI itself never starts an agent process.

This is a breaking 0.x change to `~/.uwf/config.yaml`:

| Old (`{command, args}`) | New (`{host, gateway}`) |
|-------------------------|-------------------------|
| `agents.<alias>.command` | `agents.<alias>.host` |
| `agents.<alias>.args` | `agents.<alias>.gateway` |

Rewrite each agent entry. Before:

```yaml
agents:
  hermes:
    command: uwf-hermes
    args: ["--verbose"]
  claude-code:
    command: uwf-claude-code
    args: []
defaultAgent: hermes
agentOverrides: {}
```

After:

```yaml
agents:
  hermes:
    host: http://127.0.0.1:7900
    gateway: hermes
  claude-code:
    host: http://127.0.0.1:7900
    gateway: claude-code
defaultAgent: hermes
agentOverrides: {}
```

The engine config validator (`normalizeAgents` in
`@united-workforce/util-agent`) now rejects any entry that still carries
`command` or `args` with a clear migration error. `uwf config set
agents.<alias>.command ...` is likewise rejected.

#### `--agent` override

`uwf thread exec --agent <value>` now accepts two shapes:

- An alias declared in `agents.*` (e.g. `--agent hermes`).
- An inline `"<host> <gateway>"` pair (e.g.
  `--agent "http://127.0.0.1:7900 claude-code"`).

The legacy bare command override (`--agent uwf-hermes`) is removed.

#### `step ask` / `step fork` deferred to Phase 4

`uwf step ask` and `uwf step fork` are temporarily disabled in this
phase. Invoking them returns a clear "not yet supported in Phase 3"
error rather than silently using the legacy spawn path. Both will be
restored in Phase 4 once the broker exposes the per-step session
replay APIs they require.

#### Multi-step session reuse & resume

The broker rows the `(threadId, role) → sessionId` mapping in its
SQLite session store. Subsequent steps for the same role on the same
thread reuse the cached Sumeru session. `uwf thread resume` reuses the
same cached session — no new Sumeru session is created on resume.

### Breaking Changes (v0.5 → v0.6) — output envelope

`uwf` now emits an ocas envelope (`{ type, value }`) for `--format json` and `--format yaml`, and the default format changed from `json` to `text`.

| Old (0.5) | New (0.6) | What to do |
|-----------|-----------|------------|
| `--format json` (bare value) | `--format raw-json` (bare value, unchanged) | Quick fix: add `raw-` prefix |
| `--format yaml` (bare value) | `--format raw-yaml` (bare value, unchanged) | Quick fix: add `raw-` prefix |
| `--format json` (bare value) | `--format json` (envelope `{type,value}`) | Recommended: parse `value` field (`jq '.value'`) |
| default `json` | default `text` (Liquid-rendered) | Pipelines must opt into `--format raw-json` or `json` |

`uwf workflow validate` now writes a `validate-result` envelope to **stdout** (`✓ valid` / `✗ invalid (N errors)\n  - <msg>`) instead of writing errors to stderr; exit codes (0/1) are unchanged.

### Breaking Changes (v0.x → v1.x)

The CLI was reorganized to clarify the four-layer architecture. **No backward compatibility** — old commands have been removed.

#### Renamed Commands

| Old Command | New Command | Notes |
|------------|-------------|-------|
| `workflow put` | `workflow add` | More intuitive verb |
| `thread step` | `thread exec` | Eliminates ambiguity with "step" noun |
| `thread list --all` | `thread list --status end` | Unified status filtering |

#### Removed Commands (Merged)

| Old Command | New Command | Notes |
|------------|-------------|-------|
| `thread running` | `thread list --status running` | Merged into unified list |

#### Removed Commands (Split)

| Old Command | New Commands | Notes |
|------------|-------------|-------|
| `thread kill` | `thread stop` or `thread cancel` | `stop` keeps thread active, `cancel` archives it |

#### Moved Commands

| Old Command | New Command | Notes |
|------------|-------------|-------|
| `thread steps` | `step list` | Moved to step layer |
| `thread step-details` | `step show` | Moved to step layer |
| `thread fork` | `step fork` | Moved to step layer (forks are step-based) |

#### Deprecation Errors

Old commands now show helpful error messages:

```bash
$ uwf thread step 01ARZ3NDEKTSV4RRFFQ69G5FAV
Error: Command 'thread step' has been removed.
Use 'thread exec' instead.

For more information, see: uwf help thread exec
```

## Internal Structure

```
src/
├── cli.ts              Commander entrypoint, command registration
├── format.ts           JSON/YAML output formatting
├── store.ts            CAS store + registry initialization
├── validate.ts         Workflow YAML validation
├── schemas.ts          CLI-local schema registration
├── moderator/          Status-based graph evaluator (next role or $END)
└── commands/
    ├── thread.ts       Thread lifecycle and exec
    ├── step.ts         Step operations (list/show/read/fork)
    ├── workflow.ts     Workflow registry (add/show/list)
    ├── cas.ts          CAS inspection and schema ops
    ├── setup.ts        Interactive/non-interactive setup
    ├── skill.ts        Built-in skill references
    └── log.ts          Process debug log management
```

## Configuration

| File | Purpose |
|------|---------|
| `~/.uwf/config.yaml` | Providers, models, default agent |
| `~/.uwf/.env` | API keys (referenced by `apiKeyEnv` in config) |
| `~/.uwf/registry.yaml` | Workflow name → CAS hash |
| `~/.uwf/threads.yaml` | Active thread head pointers |
| `~/.ocas/` | Content-addressed node storage (unified CAS store, shared with `ocas` CLI) |

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OCAS_HOME` | Override the global CAS directory location | `~/.ocas` |
| `UWF_HOME` | Override the workflow metadata storage root | `~/.uwf` |

