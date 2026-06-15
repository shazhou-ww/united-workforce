# United Workforce (uwf)

[![CI](https://github.com/shazhou-ww/united-workforce/actions/workflows/ci.yml/badge.svg)](https://github.com/shazhou-ww/united-workforce/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@united-workforce/cli?label=%40united-workforce%2Fcli)](https://www.npmjs.com/package/@united-workforce/cli)
[![npm](https://img.shields.io/npm/v/@united-workforce/protocol?label=%40united-workforce%2Fprotocol)](https://www.npmjs.com/package/@united-workforce/protocol)
[![npm](https://img.shields.io/npm/v/@united-workforce/util-agent?label=%40united-workforce%2Futil-agent)](https://www.npmjs.com/package/@united-workforce/util-agent)

A stateless workflow engine driven by a single-step CLI. Workflows are YAML definitions with roles, status-based routing, and a directed graph. Threads are immutable CAS-linked chains — each `uwf thread step` runs one moderator→agent→extract cycle and exits.

## Overview

This monorepo implements **uwf**, a workflow engine with no long-running daemon. You register YAML workflow definitions in a content-addressed store (CAS), start a thread with an initial prompt, then invoke `uwf thread step` repeatedly until the moderator routes to `$END`. Each step is a complete process: the moderator evaluates status-based routing to pick the next role, an external agent CLI produces frontmatter markdown output, and an extract pipeline validates or structures that output against the role's JSON Schema.

Workflow state lives entirely on disk: CAS nodes under `~/.ocas/` for definitions and step payloads, and `~/.ocas/variables.db` for all metadata (`@uwf/registry/*` for workflow name→hash mappings, `@uwf/thread/*` for active thread head pointers, `@uwf/history/*` for completed/cancelled threads). Config is at `~/.uwf/config.yaml`. Because there is no server process, workflows are easy to debug, fork, and inspect with ordinary CLI tools.

Agents are pluggable Sumeru gateways reachable over HTTP (`hermes`, `builtin`, `claude-code`, or any custom gateway). The engine no longer spawns CLI subprocesses — instead, it calls `broker.send({ threadId, role, prompt })` against the Sumeru endpoint declared as `{host, gateway}` in `~/.uwf/config.yaml`. The broker keeps a `(threadId, role) → sessionId` map in a SQLite store so subsequent steps for the same role reuse the same Sumeru session, and the CLI runs frontmatter extraction on the broker's reply to produce the StepNode and detail CAS node for session replay.

## Workflow YAML Format

Workflow definitions are YAML files with a top-level `version` field:

```yaml
version: 1
name: solve-issue
description: Resolve a Gitea/GitHub issue end-to-end.
roles:
  planner: { goal: "...", ... }
  developer: { goal: "...", ... }
graph:
  planner: { ready: developer }
  developer: { done: $END }
```

The `version` field is an integer identifying the YAML format version. Legacy YAML without `version` is accepted (falls back to `1`) but `uwf workflow add` will emit a warning.

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

Use `-c, --count <number>` on `thread exec` to run multiple steps in one invocation. Override the agent with `--agent <alias>` (an entry from your `agents` map) or with an inline `--agent "<host> <gateway>"` pair.

## Architecture

Dependency layers (lower layers have no dependency on higher layers):

```
Layer 0 — Contract
  protocol          Shared types and JSON Schema definitions

Layer 1 — Shared infra
  util              Encoding, IDs, logging, frontmatter, paths

Layer 2 — Agent framework
  util-agent        createAgent factory, context builder, extract pipeline

Layer 3 — Broker
  broker            Sumeru gateway client (HTTP send/resume/poke + session-store)

Layer 4 — In-process adapters
  agent-builtin     Built-in LLM + tools agent (uwf-builtin)
  agent-mock        Test-only mock adapter (uwf-mock)

Layer 5 — CLI
  cli               uwf binary — thread lifecycle, registry, CAS, setup (includes status-based moderator)

App (uses protocol; not in the runtime engine stack)
  dashboard         Web UI for visual workflow editing
  eval              Evaluation harness
```

> **Note (Phase 4 cleanup, #381):** the per-agent CLI binary packages
> `agent-hermes`, `agent-claude-code`, and `agent-sumeru` have been
> archived under [`legacy-packages/`](./legacy-packages/) and are no longer
> published. Sumeru-hosted agents are now reached through `@united-workforce/broker`
> over HTTP, configured as `agents.<name>: { host, gateway }` in `~/.uwf/config.yaml`.

External CAS: [`@ocas/core`](https://www.npmjs.com/package/@ocas/core) (store API, hashing, schema validation) + `@ocas/fs` (filesystem backend).

See [docs/architecture.md](docs/architecture.md) for the full design — three-phase engine loop, CAS node types, storage layout, agent CLI protocol, and design decisions.

## Packages

| Package | npm | Description | Type | README |
|---------|-----|-------------|------|--------|
| `cli` | `@united-workforce/cli` | `uwf` CLI — thread lifecycle, workflow registry, CAS inspection, setup | cli | [README](packages/cli/README.md) |
| `protocol` | `@united-workforce/protocol` | Shared TypeScript types and JSON Schema constants | lib | [README](packages/protocol/README.md) |
| `util-agent` | `@united-workforce/util-agent` | `createAgent` factory, context builder, extract pipeline | lib | [README](packages/util-agent/README.md) |
| `util` | `@united-workforce/util` | Crockford Base32, ULID, logger, frontmatter parsing, storage paths | lib | [README](packages/util/README.md) |
| `broker` | `@united-workforce/broker` | Sumeru gateway HTTP client + `(threadId, role) → sessionId` session store | lib | [README](packages/broker/README.md) |
| `agent-builtin` | `@united-workforce/agent-builtin` | `uwf-builtin` — built-in LLM agent with file/shell tools | agent | [README](packages/agent-builtin/README.md) |
| `agent-mock` | `@united-workforce/agent-mock` | `uwf-mock` — test-only mock adapter | agent | [README](packages/agent-mock/README.md) |
| `dashboard` | `@united-workforce/dashboard` | Web graph editor for workflow YAML (private, alpha) | app | [README](packages/dashboard/README.md) |
| `eval` | `@united-workforce/eval` | Evaluation harness for workflow runs | app | [README](packages/eval/README.md) |

### Archived

The following packages were the per-agent CLI adapters used before the
broker rollout. They are preserved under [`legacy-packages/`](./legacy-packages/)
for historical reference and are no longer published:

| Package | Replacement | Source |
|---------|-------------|--------|
| `@united-workforce/agent-hermes` | `@united-workforce/broker` (Sumeru gateway) | [legacy-packages/agent-hermes](legacy-packages/agent-hermes/README.md) |
| `@united-workforce/agent-claude-code` | `@united-workforce/broker` (Sumeru gateway) | [legacy-packages/agent-claude-code](legacy-packages/agent-claude-code/README.md) |
| `@united-workforce/agent-sumeru` | `@united-workforce/broker` (Sumeru gateway) | [legacy-packages/agent-sumeru](legacy-packages/agent-sumeru/README.md) |

## CLI Reference

Global options: `-V, --version`, `--format <text|json|yaml|raw-json|raw-yaml>` (default: `text`), `-h, --help`.

### Output formats

| Format | Shape | Use case |
|--------|-------|----------|
| `text` (default) | Liquid-rendered, human-readable | Interactive terminal use |
| `json` | `{"type": "<schemaHash>", "value": <payload>}` | Self-describing JSON |
| `yaml` | YAML envelope with `type` and `value` keys | Self-describing YAML |
| `raw-json` | bare `<payload>` (no envelope) | 0.5.0-compatible JSON |
| `raw-yaml` | bare `<payload>` (no envelope) | 0.5.0-compatible YAML |

### Migration: 0.5.x → 0.6

In 0.5.x, `--format json` and `--format yaml` emitted the bare value. As of 0.6, `json`/`yaml` wrap the payload in an ocas envelope (`{ type, value }`) so consumers can dispatch on the schema hash. Scripts that parsed the bare value can either:

- **Quick fix** — change `--format json` → `--format raw-json` (and `--format yaml` → `--format raw-yaml`) to preserve the previous output byte-for-byte.
- **Recommended** — switch to the new envelope and read the payload from `value` (`jq '.value'` for JSON, `yq '.value'` for YAML). This makes scripts robust against schema additions and lets them validate `type` against `@uwf/output/<name>` from `@united-workforce/protocol`.

The default format also changed from `json` to `text`. Pipelines that captured stdout for machine parsing must pass `--format raw-json` (or `json` if migrated).

| Group | Commands |
|-------|----------|
| **thread** | `start`, `exec`, `show`, `list`, `stop`, `cancel`, `read` |
| **step** | `list`, `show`, `read`, `fork` |
| **workflow** | `add`, `show`, `list` |
| **cas** | `get`, `put`, `put-text`, `has`, `refs`, `walk`, `reindex`, `schema list`, `schema get` |
| **setup** | Interactive, or `--agent <name>` to set the default agent non-interactively |
| **skill** | `cli` — print markdown reference of all uwf commands |
| **log** | `list`, `show`, `clean` — process-level debug logs |

Engine config (`~/.uwf/config.yaml`) is LLM-free — it only tracks `agents`,
`defaultAgent`, and `agentOverrides`. Each agent adapter loads its own LLM
configuration from a path it owns (e.g.
`~/.uwf/agents/builtin.yaml` for the builtin adapter).

Detailed command usage, options, and examples: [packages/cli/README.md](packages/cli/README.md).

## Development

```bash
bun install --no-cache     # Install dependencies
bun run build              # tsc --build (all packages)
bun run check              # tsc + biome + lint-log-tags
bun run format             # Auto-format with Biome
bun test                   # Run all tests
```

Managed with **bun workspace**. See [CLAUDE.md](CLAUDE.md) for coding conventions.
