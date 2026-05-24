# @uncaged/cli-workflow

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
- **Turn** (layer 4): Agent-internal interactions (use `step read` or CAS to inspect)

This package has no library `src/index.ts` — it is consumed as a CLI binary only.

**Dependencies:** `@uncaged/json-cas`, `@uncaged/json-cas-fs`, `@uncaged/workflow-agent-kit`, `@uncaged/workflow-moderator`, `@uncaged/workflow-protocol`, `@uncaged/workflow-util`, `commander`, `dotenv`, `yaml`

## Installation

Included as the `uwf` binary when you install `@uncaged/cli-workflow`:

```bash
bun add -g @uncaged/cli-workflow
# or from the monorepo:
bun link packages/cli-workflow
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
| `uwf thread list [--status <idle\|running\|completed>]` | List threads, optionally filtered by status |
| `uwf thread read <thread-id> [--quota N] [--before <hash>] [--start]` | Render thread as readable markdown |
| `uwf thread stop <thread-id>` | Stop background execution (keep thread active) |
| `uwf thread cancel <thread-id>` | Cancel thread (stop + archive to history) |

Examples:

```bash
uwf thread start solve-issue -p "Fix the login redirect bug"
uwf thread exec 01ARZ3NDEKTSV4RRFFQ69G5FAV
uwf thread exec 01ARZ3NDEKTSV4RRFFQ69G5FAV -c 3 --agent uwf-builtin
uwf thread exec 01ARZ3NDEKTSV4RRFFQ69G5FAV --background
uwf thread list --status running
uwf thread read 01ARZ3NDEKTSV4RRFFQ69G5FAV --quota 8000
uwf thread stop 01ARZ3NDEKTSV4RRFFQ69G5FAV
```

### Step (Layer 3: Single Cycle Results)

| Command | Description |
|---------|-------------|
| `uwf step list <thread-id>` | List all steps in a thread chronologically |
| `uwf step show <step-hash>` | Show step metadata and frontmatter |
| `uwf step read <step-hash> [--before N]` | Read step output as markdown |
| `uwf step fork <step-hash>` | Fork a thread from a specific step |

Examples:

```bash
uwf step list 01ARZ3NDEKTSV4RRFFQ69G5FAV
uwf step show 32GCDE899RRQ3
uwf step read 32GCDE899RRQ3 --before 3
uwf step fork 32GCDE899RRQ3
```

### Workflow (Layer 1: Templates)

| Command | Description |
|---------|-------------|
| `uwf workflow add <file.yaml>` | Register a workflow from YAML |
| `uwf workflow show <name-or-hash>` | Show workflow definition |
| `uwf workflow list` | List registered workflows |

### CAS

| Command | Description |
|---------|-------------|
| `uwf cas get <hash> [--timestamp]` | Read a CAS node |
| `uwf cas put <type-hash> <data>` | Store a node, print hash |
| `uwf cas put-text <text>` | Store plain text, print hash |
| `uwf cas has <hash>` | Check existence |
| `uwf cas refs <hash>` | List direct references |
| `uwf cas walk <hash>` | Recursive traversal |
| `uwf cas reindex` | Rebuild type index |
| `uwf cas schema list` | List registered schemas |
| `uwf cas schema get <hash>` | Show a schema |

### Setup

```bash
uwf setup
uwf setup --provider openai --base-url https://api.openai.com/v1 \
  --api-key sk-... --model gpt-4o --agent hermes
```

Config: `~/.uncaged/workflow/config.yaml`. API keys: `~/.uncaged/workflow/.env`.

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
| `thread list --all` | `thread list --status completed` | Unified status filtering |

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
| `~/.uncaged/workflow/config.yaml` | Providers, models, default agent |
| `~/.uncaged/workflow/.env` | API keys (referenced by `apiKeyEnv` in config) |
| `~/.uncaged/workflow/registry.yaml` | Workflow name → CAS hash |
| `~/.uncaged/workflow/threads.yaml` | Active thread head pointers |
| `~/.uncaged/workflow/cas/` | Content-addressed node storage |
