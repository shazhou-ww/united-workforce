# @uncaged/workflow

A stateless workflow engine driven by a single-step CLI. Workflows are YAML definitions with roles, JSONata routing conditions, and a directed graph. Threads are immutable CAS-linked chains — each `uwf thread step` runs one moderator→agent→extract cycle and exits.

## Package Map

| Package | npm | Role |
|---------|-----|------|
| `cli-workflow` | `@uncaged/cli-workflow` | `uwf` CLI binary — thread lifecycle, workflow registry, CAS inspection, setup |
| `workflow-protocol` | `@uncaged/workflow-protocol` | Shared TypeScript types (`WorkflowPayload`, `StepNodePayload`, `WorkflowConfig`, etc.) |
| `workflow-moderator` | `@uncaged/workflow-moderator` | JSONata graph evaluator — determines next role or `$END` |
| `workflow-agent-kit` | `@uncaged/workflow-agent-kit` | `createAgent` factory, context builder, two-layer extract pipeline |
| `workflow-agent-hermes` | `@uncaged/workflow-agent-hermes` | `uwf-hermes` agent — spawns Hermes chat, captures session |
| `workflow-util` | `@uncaged/workflow-util` | Crockford Base32, ULID, logger, frontmatter parsing |

External: [`@uncaged/json-cas`](https://www.npmjs.com/package/@uncaged/json-cas) (CAS store + JSON Schema validation) + `@uncaged/json-cas-fs` (filesystem backend).

## Quick Start

```bash
# 1. Configure provider and model
uwf setup

# 2. Register a workflow from YAML
uwf workflow put examples/solve-issue.yaml

# 3. Start a thread
uwf thread start solve-issue -p "Fix the login redirect bug"

# 4. Execute steps (one at a time, until done)
uwf thread step <thread-id>
```

## CLI Commands

### Thread

| Command | Description |
|---------|-------------|
| `uwf thread start <workflow> -p <prompt>` | Create a thread (no execution) |
| `uwf thread step <thread-id> [--agent <cmd>]` | Execute one moderator→agent→extract cycle |
| `uwf thread show <thread-id>` | Show head pointer and done status |
| `uwf thread list [--all]` | List threads (`--all` includes archived) |
| `uwf thread steps <thread-id>` | List all steps chronologically |
| `uwf thread read <thread-id> [--quota N]` | Render thread as readable markdown |
| `uwf thread fork <step-hash>` | Fork from a specific step |
| `uwf thread step-details <step-hash>` | Dump full detail node |
| `uwf thread kill <thread-id>` | Terminate and archive |

### Workflow

| Command | Description |
|---------|-------------|
| `uwf workflow put <file.yaml>` | Register a workflow from YAML |
| `uwf workflow show <name-or-hash>` | Show workflow definition |
| `uwf workflow list` | List registered workflows |

### CAS

| Command | Description |
|---------|-------------|
| `uwf cas get <hash>` | Read a CAS node |
| `uwf cas put <type-hash> <data>` | Store a node |
| `uwf cas has <hash>` | Check existence |
| `uwf cas refs <hash>` | List direct references |
| `uwf cas walk <hash>` | Recursive traversal |
| `uwf cas reindex` | Rebuild type index |
| `uwf cas schema list` | List schemas |
| `uwf cas schema get <hash>` | Show a schema |

### Setup

| Command | Description |
|---------|-------------|
| `uwf setup` | Interactive provider/model/agent configuration |
| `uwf setup --provider ... --base-url ... --api-key ... --model ...` | Non-interactive setup |

Config stored in `~/.uncaged/workflow/config.yaml`. API keys in `~/.uncaged/workflow/.env`.

## Development

```bash
bun install --no-cache     # Install dependencies
bun run check              # tsc + biome + lint-log-tags
bun run format             # Auto-format with Biome
bun test                   # Run all tests
```

Managed with **bun workspace**. See [CLAUDE.md](CLAUDE.md) for coding conventions.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full design — three-phase engine loop, CAS node types, storage layout, agent CLI protocol, and design decisions.
