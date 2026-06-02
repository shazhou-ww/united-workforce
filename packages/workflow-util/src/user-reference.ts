export function generateUserReference(): string {
  return `# User Reference

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

Config is stored at \`~/.uwf/config.yaml\`. Override storage root with \`UWF_STORAGE_ROOT\` (or \`WORKFLOW_STORAGE_ROOT\`).

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
uwf thread list                                    # list all threads
               [--status <filter>]                 # idle, running, completed, cancelled, active (comma-separated)
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
\`\`\`

Forking creates a new thread that shares history up to the fork point — useful for retrying from a known-good state.

## CAS Commands

\`\`\`
uwf cas get <hash>                 # read a node (type + payload)
            [--timestamp]          # include timestamp
uwf cas put <type-hash> <data>     # store typed JSON, print hash
uwf cas put-text <text>            # store plain text, print hash
uwf cas has <hash>                 # check existence
uwf cas refs <hash>                # list direct references
uwf cas walk <hash>                # recursive traversal
uwf cas reindex                    # rebuild type index
uwf cas schema list                # list schemas
uwf cas schema get <hash>          # show schema definition
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

## Other Skill References

For specific scenarios, run the corresponding \`uwf skill\` command:

| Scenario | Command | When to use |
|----------|---------|-------------|
| Writing workflow YAML | \`uwf skill author\` | Designing roles, conditions, graphs, and edge prompts |
| Contributing to the engine | \`uwf skill developer\` | Modifying the workflow engine codebase itself |
| Building a new agent adapter | \`uwf skill adapter\` | Creating a new \`uwf-<name>\` CLI adapter |
`;
}
