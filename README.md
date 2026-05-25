# @uncaged/workflow

[![CI](https://github.com/shazhou-ww/uncaged-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/shazhou-ww/uncaged-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@uncaged/cli-workflow?label=%40uncaged%2Fcli-workflow)](https://www.npmjs.com/package/@uncaged/cli-workflow)
[![npm](https://img.shields.io/npm/v/@uncaged/workflow-protocol?label=%40uncaged%2Fworkflow-protocol)](https://www.npmjs.com/package/@uncaged/workflow-protocol)
[![npm](https://img.shields.io/npm/v/@uncaged/workflow-agent-kit?label=%40uncaged%2Fworkflow-agent-kit)](https://www.npmjs.com/package/@uncaged/workflow-agent-kit)

A stateless workflow engine driven by a single-step CLI. Workflows are YAML definitions with roles, status-based routing, and a directed graph. Threads are immutable CAS-linked chains — each `uwf thread step` runs one moderator→agent→extract cycle and exits.

## Overview

This monorepo implements **uwf**, a workflow engine with no long-running daemon. You register YAML workflow definitions in a content-addressed store (CAS), start a thread with an initial prompt, then invoke `uwf thread step` repeatedly until the moderator routes to `$END`. Each step is a complete process: the moderator evaluates status-based routing to pick the next role, an external agent CLI produces frontmatter markdown output, and an extract pipeline validates or structures that output against the role's JSON Schema.

Workflow state lives entirely on disk under `~/.uncaged/workflow/`: CAS nodes for definitions and step payloads, `registry.yaml` for workflow name→hash mappings, and `threads.yaml` for active thread head pointers. Completed threads are archived to `history.jsonl`. Because there is no server process, workflows are easy to debug, fork, and inspect with ordinary CLI tools.

Agents are pluggable CLI binaries (`uwf-hermes`, `uwf-builtin`, `uwf-claude-code`, or custom commands). The engine spawns the configured agent with `<thread-id>` and `<role>`, sets `UWF_EDGE_PROMPT` from the graph transition, and captures both the agent's markdown output and a detail CAS node for session replay.

## Install

```bash
npm install -g @uncaged/cli-workflow
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
  workflow-moderator         Status-based graph evaluator

Layer 2 — Agent framework
  workflow-agent-kit         createAgent factory, context builder, extract pipeline

Layer 3 — Agent implementations
  workflow-agent-hermes      Hermes ACP agent (uwf-hermes)
  workflow-agent-builtin     Built-in LLM + tools agent (uwf-builtin)
  workflow-agent-claude-code Claude Code agent (uwf-claude-code)

Layer 4 — CLI
  cli-workflow               uwf binary — thread lifecycle, registry, CAS, setup

App (uses protocol; not in the runtime engine stack)
  workflow-dashboard         Web UI for visual workflow editing
```

External CAS: [`@uncaged/json-cas`](https://www.npmjs.com/package/@uncaged/json-cas) (store API, hashing, schema validation) + `@uncaged/json-cas-fs` (filesystem backend).

See [docs/architecture.md](docs/architecture.md) for the full design — three-phase engine loop, CAS node types, storage layout, agent CLI protocol, and design decisions.

## Packages

| Package | npm | Description | Type | README |
|---------|-----|-------------|------|--------|
| `cli-workflow` | `@uncaged/cli-workflow` | `uwf` CLI — thread lifecycle, workflow registry, CAS inspection, setup | cli | [README](packages/cli-workflow/README.md) |
| `workflow-protocol` | `@uncaged/workflow-protocol` | Shared TypeScript types and JSON Schema constants | lib | [README](packages/workflow-protocol/README.md) |
| `workflow-moderator` | `@uncaged/workflow-moderator` | Status-based graph evaluator — next role or `$END` | lib | [README](packages/workflow-moderator/README.md) |
| `workflow-agent-kit` | `@uncaged/workflow-agent-kit` | `createAgent` factory, context builder, extract pipeline | lib | [README](packages/workflow-agent-kit/README.md) |
| `workflow-util` | `@uncaged/workflow-util` | Crockford Base32, ULID, logger, frontmatter parsing, storage paths | lib | [README](packages/workflow-util/README.md) |
| `workflow-agent-hermes` | `@uncaged/workflow-agent-hermes` | `uwf-hermes` — spawns Hermes chat via ACP | agent | [README](packages/workflow-agent-hermes/README.md) |
| `workflow-agent-builtin` | `@uncaged/workflow-agent-builtin` | `uwf-builtin` — built-in LLM agent with file/shell tools | agent | [README](packages/workflow-agent-builtin/README.md) |
| `workflow-agent-claude-code` | `@uncaged/workflow-agent-claude-code` | `uwf-claude-code` — spawns Claude Code CLI | agent | [README](packages/workflow-agent-claude-code/README.md) |
| `workflow-dashboard` | `@uncaged/workflow-dashboard` | Web graph editor for workflow YAML (private, alpha) | app | [README](packages/workflow-dashboard/README.md) |

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

Config is stored in `~/.uncaged/workflow/config.yaml`. API keys go in `~/.uncaged/workflow/.env`.

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
