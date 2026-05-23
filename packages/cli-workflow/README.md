# @uncaged/cli-workflow

`uwf` CLI — thread lifecycle, workflow registry, CAS inspection, and setup.

## Overview

Layer 4 entry point for the workflow engine. The `uwf` binary orchestrates one step per invocation: load thread head from `threads.yaml`, run the moderator, spawn the configured agent CLI, run extract, append a CAS step node, and update the head pointer (or archive when `$END`).

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

### Thread

| Command | Description |
|---------|-------------|
| `uwf thread start <workflow> -p <prompt>` | Create a thread without executing |
| `uwf thread step <thread-id> [--agent <cmd>] [-c <count>]` | Execute one or more moderator→agent→extract cycles |
| `uwf thread show <thread-id>` | Show thread head pointer |
| `uwf thread list [--all]` | List active threads (`--all` includes archived) |
| `uwf thread steps <thread-id>` | List all steps chronologically |
| `uwf thread read <thread-id> [--quota N] [--before <hash>] [--start]` | Render thread as readable markdown |
| `uwf thread fork <step-hash>` | Fork from a specific step |
| `uwf thread step-details <step-hash>` | Dump full detail node as YAML |
| `uwf thread kill <thread-id>` | Terminate and archive |

Examples:

```bash
uwf thread start solve-issue -p "Fix the login redirect bug"
uwf thread step 01ARZ3NDEKTSV4RRFFQ69G5FAV
uwf thread step 01ARZ3NDEKTSV4RRFFQ69G5FAV -c 3 --agent uwf-builtin
uwf thread read 01ARZ3NDEKTSV4RRFFQ69G5FAV --quota 8000
```

### Workflow

| Command | Description |
|---------|-------------|
| `uwf workflow put <file.yaml>` | Register a workflow from YAML |
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

## Internal Structure

```
src/
├── cli.ts              Commander entrypoint, command registration
├── format.ts           JSON/YAML output formatting
├── store.ts            CAS store + registry initialization
├── validate.ts         Workflow YAML validation
├── schemas.ts          CLI-local schema registration
└── commands/
    ├── thread.ts       Thread lifecycle and step execution
    ├── workflow.ts     Workflow registry (put/show/list)
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
