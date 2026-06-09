# @united-workforce/cli

`uwf` CLI — thread lifecycle, workflow registry, CAS inspection, and setup.

## Overview

Layer 4 entry point for the workflow engine. The `uwf` binary orchestrates one step per invocation: load thread head from `threads.yaml`, run the moderator, spawn the configured agent CLI, run extract, append a CAS step node, and update the head pointer (or archive when `$END`).

### Four-Layer Architecture

```
workflow → thread → step → turn
模板定义   执行实例   单步结果   agent内部交互
```

- **Workflow** (layer 1): YAML template with roles and routing graph
- **Thread** (layer 2): Single workflow execution instance
- **Step** (layer 3): One moderator→agent→extract cycle
- **Turn** (layer 4): Agent-internal interactions (use `step show` or CAS to inspect)

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
-V, --version          Show version
--format <json|yaml>   Output format (default: json)
-h, --help             Show help
```

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
| `uwf thread cancel <thread-id>` | Cancel thread (stop + archive to history) |

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
| `uwf step fork <step-hash>` | Fork a thread from a specific step |
| `uwf step ask <step-hash> -p <prompt> [--agent <cmd>] [--no-fork]` | Ask a follow-up question to a historical step's agent (read-only; no thread mutation) |

Examples:

```bash
uwf step list 01ARZ3NDEKTSV4RRFFQ69G5FAV
uwf step show 32GCDE899RRQ3
uwf step read 32GCDE899RRQ3 --quota 2000
uwf step fork 32GCDE899RRQ3
uwf step ask 32GCDE899RRQ3 -p "Why did you choose this approach?"
uwf step ask 32GCDE899RRQ3 -p "Summarise the key findings" --no-fork
```

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

