---
scenario: "uwf-sumeru exposes a CLI binary that accepts the standard --thread/--role/--prompt argv contract"
feature: agent-sumeru
tags: [agent, sumeru, cli, packaging]
---

## Given

- A new package `@united-workforce/agent-sumeru` exists at `packages/agent-sumeru/`.
- The package layout mirrors the existing adapter packages (`packages/agent-hermes/`,
  `packages/agent-claude-code/`):
  - `package.json` with `"type": "module"`
  - `"bin": { "uwf-sumeru": "./dist/cli.js" }`
  - `src/cli.ts` (binary entry point)
  - `src/sumeru.ts` (adapter implementation)
  - `src/index.ts` (re-exports — public API surface)
  - `src/types.ts` (folder-module types per CLAUDE.md `Folder Module Discipline`)
  - `__tests__/` (vitest tests; `test`, `test:ci` scripts present)
  - `tsconfig.json` extending the root `tsconfig.json`
- `package.json` declares the following workspace dependencies (and only these for
  runtime):
  - `@ocas/core` (for `Store` typing only — the adapter does not need the schema helpers)
  - `@united-workforce/protocol` (`workspace:^`)
  - `@united-workforce/util` (`workspace:^`)
  - `@united-workforce/util-agent` (`workspace:^`)
- The repo build order (`scripts/publish-all.mjs`) and root `pnpm-workspace.yaml` /
  `tsconfig.json` `references` include the new package so `pnpm run build` and
  `pnpm run typecheck` from the repo root walk it.

## When

- `pnpm run build` is executed at the monorepo root.
- The published `uwf-sumeru` binary is invoked with one of:
  - `uwf-sumeru --version` (or `-V`)
  - `uwf-sumeru --thread <id> --role <role> --prompt <text>`
  - `uwf-sumeru` with one of `--thread`, `--role`, `--prompt` missing.

## Then

- Build:
  - `pnpm run build` produces `packages/agent-sumeru/dist/cli.js` with a Node shebang
    (`#!/usr/bin/env -S node --disable-warning=ExperimentalWarning`) consistent with
    the other adapters' CLI entry point.
  - `pnpm run check`, `pnpm run typecheck`, and `pnpm run test` all pass with the
    new package included.

- Version handling:
  - `uwf-sumeru --version` (or `-V`) prints the package version from
    `packages/agent-sumeru/package.json` to stdout and exits with code `0` BEFORE
    any HTTP traffic is attempted.
  - `--version` MUST NOT contact any Sumeru instance and MUST NOT read the adapter
    config file.

- Normal invocation:
  - `uwf-sumeru --thread <id> --role <role> --prompt <text>` is the contract uwf
    expects from every agent CLI (`packages/util-agent/src/run.ts` `parseArgv`).
  - The CLI delegates to `@united-workforce/util-agent`'s `createAgent({ name: "sumeru",
    run, continue, fork: null, cleanup })` factory — the entry point does NOT
    re-implement argv parsing, prompt assembly, frontmatter extraction, or
    StepNode persistence; those live in `util-agent` and MUST be reused unchanged.
  - On success the CLI writes a single JSON line (`AdapterOutput`) to stdout (the
    shape produced by `createAgent` — `{ stepHash, detailHash, role, frontmatter,
    body, startedAtMs, completedAtMs, usage, isError, errorMessage }`) and exits
    with code `0`.

- Argument validation:
  - Any of `--thread`, `--role`, `--prompt` missing or empty causes the CLI to
    exit non-zero with the shared usage message from `util-agent`'s `parseArgv`
    (`usage: <agent-cli> --thread <id> --role <role> --prompt <text>`). The
    sumeru adapter MUST NOT swallow that error path.

- Logging:
  - All log output goes through `createLogger` from `@united-workforce/util` with
    fixed 8-char Crockford Base32 tags per call site (per CLAUDE.md `Logging`
    rules). `console.log` / `console.error` are forbidden in adapter source
    files; only the CLI binary entry point may use `process.stdout.write` /
    `process.stderr.write` for the `AdapterOutput` JSON line and the `--version`
    print.
