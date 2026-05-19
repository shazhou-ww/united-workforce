# @uncaged/cli-workflow

Command-line interface for the Uncaged workflow engine (`uncaged-workflow`).

The CLI reads and writes the workflow registry, starts and inspects threads, manages CAS blobs, and prints agent-oriented reference docs via `skill`. It uses the same storage layout as `@uncaged/workflow` (default `~/.uncaged/workflow`).

## Install

```bash
bun add @uncaged/cli-workflow
```

In this monorepo: `"@uncaged/cli-workflow": "workspace:*"`. Depends on `"@uncaged/workflow": "workspace:*"`.

## Usage

```bash
uncaged-workflow workflow list
uncaged-workflow run <name> --prompt "Your task"
uncaged-workflow thread show <id>
uncaged-workflow skill
```

Invoking the CLI with no command (or from this repo: `bun packages/cli-workflow/src/cli.ts`) prints:

```
uncaged-workflow — workflow engine CLI

Workflow registry:
  workflow add <name> <file.esm.js> [--types <path>]  Register a workflow bundle in the registry
  workflow list                                       List all registered workflows
  workflow show <name>                                Show details of a registered workflow
  workflow rm <name>                                  Remove a workflow from the registry
  workflow history <name>                             Show version history of a workflow
  workflow rollback <name> [hash]                     Rollback a workflow to a previous version

Thread execution:
  thread run <name> [--prompt <text>] [--max-rounds N]          Start a new thread executing a workflow
  thread list [name]                                            List threads, optionally filtered by workflow name
  thread show <id>                                              Show thread details and state
  thread rm <id>                                                Remove a thread
  thread fork <thread-id> [--from-role <role>]                  Fork a thread, optionally from a specific role
  thread ps                                                     List running threads
  thread kill <thread-id>                                       Kill a running thread
  thread live <thread-id> | --latest [--debug] [--role <name>]  Attach to a thread and stream output live
  thread pause <thread-id>                                      Pause a running thread
  thread resume <thread-id>                                     Resume a paused thread

Content-addressable storage:
  cas get <hash>     Retrieve content by hash from CAS
  cas put <content>  Store content in CAS, prints hash
  cas list           List all hashes in CAS
  cas rm <hash>      Remove a CAS entry by hash
  cas gc             Garbage-collect unreferenced CAS entries

Development:
  init workspace <name>  Initialize a new workflow workspace
  init template <name>   Initialize a new workflow template

Shortcuts:
  run <name> [...]  → thread run
  live <id> [...]   → thread live

Reference:
  skill [topic]  Agent-consumable docs (cli, develop, author)

Use <command> --help for subcommand details.

Environment variables:
  WORKFLOW_STORAGE_ROOT              Override storage directory (default: ~/.uncaged/workflow)
  UNCAGED_WORKFLOW_STORAGE_ROOT      Internal override (takes priority over WORKFLOW_STORAGE_ROOT)
```

## API overview

This package is bin-only; programmatic use is via `@uncaged/workflow`. Entry: `src/cli.ts` → `runCli` in `src/cli-dispatch.js`.
