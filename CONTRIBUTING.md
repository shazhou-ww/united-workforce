# Contributing to @united-workforce/cli

Thank you for your interest in contributing! This guide covers setup, conventions, and the PR workflow.

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Node.js](https://nodejs.org/) 20+
- Git

## Setup

```bash
git clone https://github.com/shazhou-ww/united-workforce.git
cd united-workforce
bun install
bun run build
bun test
```

## Development Workflow

```bash
bun run build     # TypeScript compilation (all packages)
bun run check     # tsc + biome lint + log tag validation
bun run format    # Auto-format with Biome
bun test          # Run all tests
```

All three (`build`, `check`, `test`) must pass before submitting a PR. A pre-push hook runs `check` + `test` automatically.

## Coding Conventions

See [CLAUDE.md](CLAUDE.md) for the full coding standard. Key points:

- **Functional-first** — `function` + `type`, not `class` + `interface`
- **No optional properties** — use `T | null` instead of `?:`
- **Named exports only** — no default exports
- **No `console.log`** — use the structured logger from `@united-workforce/util`
- **Static imports only** — no `await import()` in production code
- **Biome** for lint + format — run `bun run check` before committing

## Commit Messages

```
<type>(<scope>): <description>

type: feat | fix | refactor | docs | chore | test
scope: cli | moderator | agent-kit | hermes | builtin | claude-code | util | protocol | dashboard
```

Examples:
- `feat(moderator): add cycle detection to graph evaluator`
- `fix(cli): handle missing config file gracefully`
- `docs(protocol): update StepNode field descriptions`

## Pull Request Process

1. **Branch** from `main`: `git checkout -b feat/123-short-description`
2. **Implement** your change with tests
3. **Run checks**: `bun run check && bun test`
4. **Commit** with a descriptive message referencing the issue: `Fixes #123`
5. **Push** and open a PR

### PR Description Template

```
## What
What this PR does.

## Why
Why the change is needed.

## Changes
- `path/to/file.ts` — what changed and why

## Ref
Fixes #N
```

## Adding a Changeset

Add a changeset for **user-facing changes** only:

- ✅ `feat`, `fix`, breaking changes
- ❌ `chore`, `test`, `docs` (unless affecting public API surface)

```bash
bun changeset
```

This creates a markdown file in `.changeset/` describing the change. It will be consumed on the next release to bump versions and generate CHANGELOG entries.

## Project Structure

```
packages/
  protocol/      # Shared types and JSON Schema
  util/          # Encoding, IDs, logging, frontmatter
  util-agent/    # createAgent factory, extract pipeline
  agent-hermes/  # Hermes ACP agent
  agent-builtin/ # Built-in LLM agent
  agent-claude-code/ # Claude Code agent
  cli/           # uwf CLI binary
  dashboard/     # Web UI (private, alpha)
```

Dependency flows downward — lower layers have no dependency on higher layers. See [CLAUDE.md](CLAUDE.md) for the full architecture.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
