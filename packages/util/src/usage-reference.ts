import { VERSION } from "./version.js";

export function generateUsageReference(): string {
  return `---
name: uwf-usage
description: "Guide for using the uwf CLI to manage workflows and threads."
version: ${VERSION}
tags: [uwf, workflow, cli, usage]
---

# Usage Reference

Guide for using the uwf CLI to manage workflows and threads.

## Quick Start

\`\`\`bash
# 1. Configure provider and model
uwf setup

# 2. Register a workflow
uwf workflow add my-workflow.yaml

# 3. Start a thread (creates but does not execute)
uwf thread start my-workflow -p "Build a login page"

# 4. Execute the thread (runs moderator → agent → extract cycles)
uwf thread exec <thread-id>          # one step
uwf thread exec <thread-id> -c 10    # up to 10 steps
uwf thread exec <thread-id> -c 10 --background  # run in background
\`\`\`

## Concepts

- **Workflow** — YAML definition with roles and a routing graph; stored as a CAS node
- **Thread** — A running instance of a workflow; a chain of step nodes in CAS
- **Step** — One moderator → agent → extract cycle; contains the role's structured output
- **CAS** — Content-addressable store; every artifact is hashed (XXH64, Crockford Base32)

## Setup

\`\`\`
uwf setup                                          # interactive wizard
uwf setup --provider <name> --base-url <url> \\
           --api-key <key> --model <name>           # non-interactive
           [--agent <name>]                         # optional default agent
\`\`\`

Config is stored at \`~/.uwf/config.yaml\`. Override storage root with \`UWF_HOME\`.

## Workflow Commands

\`\`\`
uwf workflow add <file>            # register from YAML file
uwf workflow show <id>             # show by name or CAS hash
uwf workflow list                  # list all registered workflows
\`\`\`

You can also pass a file path directly to \`uwf thread start\` without registering first.

## Thread Lifecycle

\`\`\`
uwf thread start <workflow> -p <prompt>            # create thread
uwf thread exec <thread-id>                        # execute one step
               [--agent <cmd>]                     # override agent
               [-c, --count <n>]                   # run n steps
               [--background]                      # run in background
uwf thread show <thread-id>                        # show head pointer
uwf thread list                                    # list active threads (idle + running)
               [--all]                             # include completed/cancelled/suspended
               [--status <filter>]                 # idle, running, suspended, completed, cancelled, active (comma-separated)
               [--after <thread-id>]               # pagination: after this thread
               [--before <thread-id>]              # pagination: before this thread
               [--skip <n>]                        # skip first n results
               [--take <n>]                        # limit results
uwf thread read <thread-id>                        # render context as markdown
               [--quota <chars>]                   # max output chars (default 4000)
               [--before <step-hash>]              # pagination
               [--start]                           # include start step
uwf thread stop <thread-id>                        # stop background execution
uwf thread cancel <thread-id>                      # cancel and archive thread
\`\`\`

### Typical Lifecycle

\`\`\`
start → exec (repeat) → thread reaches $END → auto-completed
                       → or: cancel to abort
\`\`\`

## Step Commands

\`\`\`
uwf step list <thread-id>         # list all steps
uwf step show <step-hash>         # show step details
uwf step fork <step-hash>         # fork thread from a step (branch)
uwf step ask <step-hash> -p <prompt> [--agent <cmd>] [--no-fork]
                                  # ask a follow-up question to the step's agent
                                  # (read-only; no new step, no thread mutation)
\`\`\`

Forking creates a new thread that shares history up to the fork point — useful for retrying from a known-good state.

\`step ask\` re-opens the agent session that produced \`<step-hash>\` and returns its answer on stdout. Subsequent asks reuse the same forked session via the per-agent ask-cache; \`--no-fork\` runs the agent fresh with the step's detail ref injected for context.

## CAS Commands

Use the \`ocas\` CLI for direct CAS operations (\`~/.ocas/\` store, shared with \`uwf\`):

\`\`\`
ocas get <hash>                 # read a node (type + payload)
            [--timestamp]          # include timestamp
ocas put <type-hash> <data>     # store typed JSON, print hash
ocas has <hash>                 # check existence
ocas refs <hash>                # list direct references
ocas walk <hash>                # recursive traversal
ocas reindex                    # rebuild type index
ocas schema list                # list schemas
ocas schema get <hash>          # show schema definition
\`\`\`

## Log Commands

\`\`\`
uwf log list                       # list log files
uwf log show                       # show log entries
           [--thread <id>]         # filter by thread
           [--process <pid>]       # filter by process
           [--date <YYYY-MM-DD>]   # filter by date
uwf log clean --before <date>      # delete old logs
\`\`\`

## Global Options

\`\`\`
uwf --format <json|yaml>           # output format (default: json)
uwf -V, --version                  # print version
\`\`\`

## Other Prompt References

For specific scenarios, run the corresponding \`uwf prompt\` command:

| Scenario | Command | When to use |
|----------|---------|-------------|
| Writing workflow YAML | \`uwf prompt workflow-authoring\` | Designing roles, conditions, graphs, and edge prompts |
| Building a new agent adapter | \`uwf prompt adapter-developing\` | Creating a new \`uwf-<name>\` CLI adapter |

## Upgrading

\`\`\`bash
# Install the latest version
pnpm add -g @united-workforce/cli@latest @united-workforce/agent-hermes@latest
# or: npm install -g @united-workforce/cli@latest @united-workforce/agent-hermes@latest

# Verify
uwf --version

# Then run uwf prompt bootstrap and follow the upgrade instructions
\`\`\`
`;
}
