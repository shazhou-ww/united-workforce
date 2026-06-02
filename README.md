# United Workforce (uwf)

[![CI](https://github.com/shazhou-ww/uncaged-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/shazhou-ww/uncaged-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@united-workforce/cli?label=%40united-workforce%2Fcli)](https://www.npmjs.com/package/@united-workforce/cli)
[![npm](https://img.shields.io/npm/v/@united-workforce/protocol?label=%40united-workforce%2Fprotocol)](https://www.npmjs.com/package/@united-workforce/protocol)
[![npm](https://img.shields.io/npm/v/@united-workforce/util-agent?label=%40united-workforce%2Futil-agent)](https://www.npmjs.com/package/@united-workforce/util-agent)

A stateless workflow engine driven by a single-step CLI. Workflows are YAML definitions with roles, status-based routing, and a directed graph. Threads are immutable CAS-linked chains — each `uwf thread step` runs one moderator→agent→extract cycle and exits.

## Overview

This monorepo implements **uwf**, a workflow engine with no long-running daemon. You register YAML workflow definitions in a content-addressed store (CAS), start a thread with an initial prompt, then invoke `uwf thread step` repeatedly until the moderator routes to `$END`. Each step is a complete process: the moderator evaluates status-based routing to pick the next role, an external agent CLI produces frontmatter markdown output, and an extract pipeline validates or structures that output against the role's JSON Schema.

Workflow state lives entirely on disk: CAS nodes under `~/.ocas/` for definitions and step payloads, and `~/.ocas/variables.db` for all metadata (`@uwf/registry/*` for workflow name→hash mappings, `@uwf/thread/*` for active thread head pointers, `@uwf/history/*` for completed/cancelled threads). Config is at `~/.uwf/config.yaml`. Because there is no server process, workflows are easy to debug, fork, and inspect with ordinary CLI tools.

Agents are pluggable CLI binaries (`uwf-hermes`, `uwf-builtin`, `uwf-claude-code`, or custom commands). The engine spawns the configured agent with `<thread-id>` and `<role>`, sets `UWF_EDGE_PROMPT` from the graph transition, and captures both the agent's markdown output and a detail CAS node for session replay.

## Install

```bash
npm install -g @united-workforce/cli
```

Requires [Bun](https://bun.sh/) runtime (used internally for TypeScript execution).

## Quick Start

```bash
# 1. Configure provider, model, and default agent
uwf setup

# 2. Register a workflow from YAML
uwf workflow add examples/solve-issue.yaml

# 3. Start a thread (creates head pointer; does not execute)
uwf thread start solve-issue -p "Fix the login redirect bug"

# 4. Execute steps (one at a time, until done)
uwf thread exec <thread-id>
```

Use `-c, --count <number>` on `thread exec` to run multiple steps in one invocation. Override the agent with `--agent <cmd>`.

## Architecture

Dependency layers (lower layers have no dependency on higher layers):

```
Layer 0 — Contract
  workflow-protocol          Shared types and JSON Schema definitions

Layer 1 — Shared infra
  workflow-util              Encoding, IDs, logging, frontmatter, paths

Layer 2 — Agent framework
  workflow-util-agent         createAgent factory, context builder, extract pipeline

Layer 3 — Agent implementations
  workflow-agent-hermes      Hermes ACP agent (uwf-hermes)
  workflow-agent-builtin     Built-in LLM + tools agent (uwf-builtin)
  workflow-agent-claude-code Claude Code agent (uwf-claude-code)

Layer 4 — CLI
  cli-workflow               uwf binary — thread lifecycle, registry, CAS, setup (includes status-based moderator)

App (uses protocol; not in the runtime engine stack)
  workflow-dashboard         Web UI for visual workflow editing
```

External CAS: [`@ocas/core`](https://www.npmjs.com/package/@ocas/core) (store API, hashing, schema validation) + `@ocas/fs` (filesystem backend).

See [docs/architecture.md](docs/architecture.md) for the full design — three-phase engine loop, CAS node types, storage layout, agent CLI protocol, and design decisions.

## Packages

| Package | npm | Description | Type | README |
|---------|-----|-------------|------|--------|
| `cli-workflow` | `@united-workforce/cli` | `uwf` CLI — thread lifecycle, workflow registry, CAS inspection, setup | cli | [README](packages/cli-workflow/README.md) |
| `workflow-protocol` | `@united-workforce/protocol` | Shared TypeScript types and JSON Schema constants | lib | [README](packages/workflow-protocol/README.md) |
| `workflow-util-agent` | `@united-workforce/util-agent` | `createAgent` factory, context builder, extract pipeline | lib | [README](packages/workflow-util-agent/README.md) |
| `workflow-util` | `@united-workforce/util` | Crockford Base32, ULID, logger, frontmatter parsing, storage paths | lib | [README](packages/workflow-util/README.md) |
| `workflow-agent-hermes` | `@united-workforce/agent-hermes` | `uwf-hermes` — spawns Hermes chat via ACP | agent | [README](packages/workflow-agent-hermes/README.md) |
| `workflow-agent-builtin` | `@united-workforce/agent-builtin` | `uwf-builtin` — built-in LLM agent with file/shell tools | agent | [README](packages/workflow-agent-builtin/README.md) |
| `workflow-agent-claude-code` | `@united-workforce/agent-claude-code` | `uwf-claude-code` — spawns Claude Code CLI | agent | [README](packages/workflow-agent-claude-code/README.md) |
| `workflow-dashboard` | `@united-workforce/dashboard` | Web graph editor for workflow YAML (private, alpha) | app | [README](packages/workflow-dashboard/README.md) |

## CLI Reference

Global options: `-V, --version`, `--format <json|yaml>`, `-h, --help`.

| Group | Commands |
|-------|----------|
| **thread** | `start`, `exec`, `show`, `list`, `stop`, `cancel`, `read` |
| **step** | `list`, `show`, `read`, `fork` |
| **workflow** | `add`, `show`, `list` |
| **cas** | `get`, `put`, `put-text`, `has`, `refs`, `walk`, `reindex`, `schema list`, `schema get` |
| **setup** | Interactive or `--provider`, `--base-url`, `--api-key`, `--model`, `--agent` |
| **skill** | `cli` — print markdown reference of all uwf commands |
| **log** | `list`, `show`, `clean` — process-level debug logs |

Config is stored in `~/.uwf/config.yaml`. API keys go in `~/.uwf/.env`.

Detailed command usage, options, and examples: [packages/cli-workflow/README.md](packages/cli-workflow/README.md).

## Development

```bash
bun install --no-cache     # Install dependencies
bun run build              # tsc --build (all packages)
bun run check              # tsc + biome + lint-log-tags
bun run format             # Auto-format with Biome
bun test                   # Run all tests
```

Managed with **bun workspace**. See [CLAUDE.md](CLAUDE.md) for coding conventions.
