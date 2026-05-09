# @uncaged/workflow

A workflow engine that executes single-file ESM bundles. Each workflow is a self-contained `.esm.js` file identified by its XXH64 hash (Crockford Base32).

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Workflow** | A single-file ESM module exporting `run` (workflow function) and `descriptor` (metadata). Identified by its XXH64 hash. |
| **Bundle** | The physical `.esm.js` file stored in `~/.uncaged/workflow/bundles/`. |
| **Thread** | A single execution of a workflow, identified by a ULID. CAS-backed chain plus `threads.json` / `history/*.jsonl`; `.info.jsonl` for debug logs. |
| **Role** | A named actor within a workflow. Each role produces output with typed `meta`. Roles live inside template packages (`src/roles/`). |
| **Registry** | `workflow.yaml` — maps workflow names to current/historical bundle hashes. |
| **CAS** | Content-Addressed Storage — bundles are immutable and addressed by hash. |

## Monorepo Packages

```
packages/
  workflow/                      # @uncaged/workflow — core lib (types, engine, hash, ULID, registry)
  cli-workflow/                  # @uncaged/cli-workflow — CLI (`uncaged-workflow` command)
  workflow-template-develop/     # @uncaged/workflow-template-develop — develop workflow template (includes roles)
  workflow-template-solve-issue/ # @uncaged/workflow-template-solve-issue — solve-issue workflow template (includes roles)
  workflow-agent-hermes/         # @uncaged/workflow-agent-hermes — Hermes agent adapter
  workflow-agent-cursor/         # @uncaged/workflow-agent-cursor — Cursor agent adapter
  workflow-agent-llm/            # @uncaged/workflow-agent-llm — LLM agent adapter
  workflow-util-agent/           # @uncaged/workflow-util-agent — agent utilities (buildAgentPrompt, spawnCli)
```

Managed with **bun workspace** using the `workspace:*` protocol.

## Quick Start

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Register a workflow bundle
uncaged-workflow workflow add solve-issue dist/packages/workflow-template-solve-issue/solve-issue.esm.js

# Run a workflow
uncaged-workflow run solve-issue --prompt "Fix bug #42"
```

## CLI Usage

```bash
uncaged-workflow                   # Print full command usage (exits with status 1)
uncaged-workflow workflow list     # List registered workflows
uncaged-workflow run <name>        # Start a workflow thread
uncaged-workflow thread list       # List all threads
uncaged-workflow thread show <id>  # Inspect a thread
uncaged-workflow skill             # Agent-consumable reference docs
```

Run `uncaged-workflow` with no arguments to print usage, or `uncaged-workflow skill cli` for the full CLI skill reference.

## Development

```bash
bun run check    # Biome lint + format check
bun run format   # Auto-format with Biome
bun test         # Run tests
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full design — three-phase engine loop, bundle contract, storage layout, and design decisions.
