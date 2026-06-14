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
# 1. Pick the default agent adapter for the engine
uwf setup

# 2. Place a workflow under .workflows/ in your project (recommended)
#    uwf thread start auto-discovers from .workflows/ by walking from cwd upward.
#    No workflow add registration needed.
mkdir -p .workflows
cp my-workflow.yaml .workflows/solve-issue.yaml

# 3. Start a thread by bare name (no file path)
uwf thread start solve-issue -p "Build a login page"

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
uwf setup                          # interactive: pick the default agent
uwf setup --agent <name>           # non-interactive: set the default agent only
\`\`\`

Engine config is LLM-free — \`~/.uwf/config.yaml\` only stores \`agents\`,
\`defaultAgent\`, and \`agentOverrides\`. Each agent adapter loads its own LLM
configuration from a path it owns (e.g. \`~/.uwf/agents/builtin.yaml\` for the
builtin adapter). Override storage root with \`UWF_HOME\`.

## Workflow Commands

\`\`\`
uwf workflow add <file>            # register from YAML file (optional)
uwf workflow validate <file>       # validate a workflow YAML without registering (CI-friendly)
uwf workflow show <id>             # show by name or CAS hash
uwf workflow list                  # list workflows (auto-discovers .workflows/ from cwd upward + global registry)
\`\`\`


Three placement strategies, in priority order:

1. **Project-local \`.workflows/\` (recommended)** — drop \`<name>.yaml\` (or \`<name>/index.yaml\`) under \`<repo>/.workflows/\`. \`uwf thread start <name>\` and \`uwf workflow list\` both auto-discover by walking from cwd upward, stopping at the nearest \`.git\` boundary (repository root). No registration step is needed. The legacy \`.workflow/\` (singular) directory is still honored as a fallback when \`.workflows/\` is absent.
2. **Explicit file path** — pass a relative or absolute \`.yaml\` path to \`uwf thread start ./path/to/workflow.yaml\`. Useful for one-off runs and testing.
3. **Global registry** — \`uwf workflow add <file>\` stores the workflow hash under \`@uwf/registry/<name>\` so it is available system-wide, independent of cwd.

## Thread Lifecycle

\`\`\`
uwf thread start <workflow> -p <prompt>            # create thread
uwf thread exec <thread-id>                        # execute one step
               [--agent <cmd>]                     # override agent
               [-c, --count <n>]                   # run n steps
               [--background]                      # run in background
uwf thread show <thread-id>                        # show head pointer
uwf thread list                                    # list active threads (idle + running)
               [--all]                             # include end/cancelled/suspended
               [--status <filter>]                 # idle, running, suspended, end, cancelled, active (comma-separated)
               [--after <thread-id>]               # pagination: after this thread
               [--before <thread-id>]              # pagination: before this thread
               [--skip <n>]                        # skip first n results
               [--take <n>]                        # limit results
uwf thread read <thread-id>                        # render context as markdown
               [--quota <chars>]                   # max output chars (default 4000)
               [--before <step-hash>]              # pagination
               [--start]                           # include start step
uwf thread resume <thread-id>                      # resume a suspended thread
               [-p, --prompt <text>]              # supplementary info appended to resume prompt
               [--agent <cmd>]                     # override agent
uwf thread poke <thread-id> -p <prompt>            # re-run head step agent (replaces head step)
               [--agent <cmd>]                     # override agent
uwf thread stop <thread-id>                        # stop background execution
uwf thread cancel <thread-id>                      # cancel and archive thread
\`\`\`

### Typical Lifecycle

\`\`\`
start → exec (repeat) → thread reaches $END → auto-end (status: end)
                       → or: role yields $SUSPEND → suspended → thread resume
                       → or: cancel to abort
\`\`\`

### Thread States

| Status | Meaning | Transitions |
|--------|---------|-------------|
| \`idle\` | Created or between steps, ready to exec | → \`running\` (exec) / \`cancelled\` (cancel) |
| \`running\` | Agent currently executing | → \`idle\` (step done) / \`suspended\` ($SUSPEND) / \`end\` ($END) |
| \`suspended\` | Paused by agent or resource limit, waiting for human | → resume / cancel |
| \`end\` | Workflow reached $END, archived | → resume (re-enter via $START.resume) |
| \`cancelled\` | Manually aborted, archived | terminal |

### Controlling Execution

\`\`\`bash
# Stop: kill the background process, thread stays idle (can exec again)
uwf thread stop <thread-id>

# Cancel: terminate thread permanently, move to history
uwf thread cancel <thread-id>
\`\`\`

**\`stop\` vs \`cancel\`**: \`stop\` only kills the running background process — the thread
remains \`idle\` and you can \`exec\` it again later. \`cancel\` is permanent: the thread
moves to \`cancelled\` status in history and cannot be resumed.

Use \`stop\` when you need to free resources temporarily (e.g. memory pressure from
concurrent threads). Use \`cancel\` when the thread is no longer needed.

### Suspend and Resume (\`$SUSPEND\`)

Any role may yield control by emitting \`$status: "$SUSPEND"\` with a \`reason\` string in its
frontmatter output. The engine intercepts this before the moderator: the step is written to CAS,
the thread status becomes \`suspended\`, and routing pauses until a human or external process
continues. Agent adapters may also emit \`$SUSPEND\` automatically when they hit resource limits
(e.g. token budget exhaustion, context window overflow) — the \`reason\` field describes the constraint.

\`\`\`yaml
---
$status: "$SUSPEND"
reason: "Need API credentials before continuing"
---
\`\`\`

Resume the suspended thread to re-run the same role with its original prompt plus optional
supplementary context:

\`\`\`bash
uwf thread resume <thread-id>
uwf thread resume <thread-id> -p "Credentials are in ~/.secrets/api.env"
\`\`\`

**⚠️ \`exec\` does not advance suspended threads** — it echoes the current state
(\`Step 1 <role> → suspended\`) and exits without doing any work. You **must** use
\`thread resume\` (optionally with \`-p\`) to unblock the thread.

\`thread resume\` also works on ended threads — it re-evaluates \`$START.resume\` and begins a
new run from the workflow's resume entry point.

### Poke

\`thread poke\` re-runs the head step's agent with a supplementary prompt, **replacing** the
head step (not appending). Unlike \`thread resume\`, poke skips the moderator and reuses the
head step's role. Works on idle and suspended threads.

\`\`\`bash
uwf thread poke <thread-id> -p "Re-read the file and fix the import error"
\`\`\`

### Re-entry Patterns

When a thread ends or gets stuck, there are several recovery strategies. **Always try
\`resume\` first** — it is the safest and most common recovery path.

#### Done Resume (preferred)

\`resume\` works on ended threads (\`status: end\`) — it resets \`done\` to \`false\` and
follows the \`$START.resume\` graph route (typically re-runs the planner with context
from the previous run).

\`\`\`bash
uwf thread resume <thread-id>
# After resume completes, continue with exec (not another resume):
uwf thread exec <thread-id> --count 10
\`\`\`

**Pitfall — resume spawns an agent**: Resume is not just a flag flip. It runs the
\`$START.resume\` target agent, which may take minutes. Use a generous timeout (300s+)
or background mode. Verify with \`thread show\` that the head step changed before
running \`exec\`.

#### Poke to Override Stale State

When \`resume\` runs the planner but the planner produces the wrong output (e.g. suspends
because it can't find expected context), use \`poke\` to inject explicit instructions:

\`\`\`bash
uwf thread poke <thread-id> -p "PR #42 has review feedback. Read: tea pr 42 --comments"
uwf thread exec <thread-id> --count 10
\`\`\`

**When to poke vs resume**: \`resume\` follows \`$START.resume\` blindly. \`poke\` replaces
the head step with your instructions — use it when the agent produced the wrong output,
not when you need to re-enter the whole workflow.

#### Step Fork (parallel exploration only)

Fork creates a **new thread** branching from a specific step. Use it only when you want
to try a different approach while keeping the original thread intact:

\`\`\`bash
uwf step fork <step-hash>
# → { "thread": "<new-thread-id>", "forkedFrom": { "step": "<hash>" } }
uwf thread exec <new-thread-id> --count 10
\`\`\`

**Prefer resume over fork** — fork means a new thread, new worktree, lost continuity.

#### Terminal-Status Threads (start fresh)

When a thread ended via a terminal status routed to \`$END\` (e.g. \`rejected → $END\`),
\`resume\` resets \`done\` but the next \`exec\` immediately re-evaluates the head step's
status — if the graph still routes it to \`$END\`, the thread ends again instantly.

**Solution**: Start a fresh thread instead of resuming. This is common with review
workflows where \`rejected → $END\` is a terminal edge.

\`\`\`bash
# ❌ resume loops back to $END
uwf thread resume <old-thread>

# ✅ start fresh
uwf thread start <workflow> -p "..."
\`\`\`

### Recovering a Stuck Thread

When a background \`exec\` process exits unexpectedly (OOM, kill, timeout) and the
thread shows \`status: running\` or is stuck at \`idle\`:

\`\`\`bash
# 1. Check thread state
uwf thread show <thread-id>
uwf step list <thread-id>

# 2. If the thread is idle, just re-exec:
uwf thread exec <thread-id> --count 10

# 3. If code was committed but the workflow didn't finish,
#    hand-finish (create PR, etc.) and cancel the thread:
uwf thread cancel <thread-id>
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

### Failed Steps

When a step fails (agent crash, frontmatter validation failure after retries), it is still recorded
in CAS with \`$status: "error"\`. The thread head is NOT advanced, so the moderator never routes on
failed steps. On successful retry, the new step includes a \`previousAttempts\` array linking to
prior failed step hashes — this forms a complete retry lineage visible via \`step show\`.

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

**Design note**: CLI output commands (\`thread list\`, \`step show\`, etc.) only **read** from
CAS (loading Liquid templates and schema hashes for rendering). They never **write** command
result data into the store — output goes to stdout only.

### CAS Troubleshooting

**\`thread list\` shows corrupt threads**: If threads reference missing or stale workflow
CAS nodes, they appear with \`status: "corrupt"\` in the listing. This can happen after
upgrading uwf (old workflow schema mismatch) or from test suite pollution (batch-created
thread variables left in the global store).

**Fix**: Cancel corrupt threads with \`uwf thread cancel <thread-id>\`. For bulk cleanup,
thread variables live in \`~/.ocas/vars/_store.db\` (SQLite, table \`vars\`).

**Cleaning up idle threads from deregistered workflows**: After removing a workflow,
old idle threads may linger with \`workflowName: null\`. Cancel them:
\`uwf thread cancel <thread-id>\`.

## Config Commands

Engine config lives in \`~/.uwf/config.yaml\` (override storage root with \`UWF_HOME\`).

\`\`\`
uwf config list                    # display all config values (API keys masked)
uwf config get <key>               # get a value by dot-notation path (e.g. defaultAgent)
uwf config set <key> <value>       # set a value (use JSON array for list values, e.g. args)
\`\`\`

Example:

\`\`\`bash
uwf config get defaultAgent
uwf config set defaultAgent uwf-hermes
\`\`\`

### Concurrency Control

Step-level concurrency limits how many agent processes can run simultaneously:

\`\`\`bash
uwf config set concurrency.maxRunning 3   # allow 3 concurrent agents (default: 2)
uwf config get concurrency.maxRunning
\`\`\`

File-based slot management with race protection (double-check-after-write with automatic
rollback) and signal handlers for cleanup on SIGINT/SIGTERM. Stale slots from dead PIDs
are auto-cleaned on each exec.

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
uwf --format <fmt>                 # output format: text (default), json, yaml, raw-json, raw-yaml
uwf -V, --version                  # print version
\`\`\`

### Output Formats

| Format | Output shape | Use case |
|--------|-------------|----------|
| \`text\` (default) | Human-readable rendered view | Interactive CLI, agent consumption |
| \`json\` | ocas envelope \`{ type, value }\` | Programmatic: self-describing typed JSON |
| \`yaml\` | ocas envelope in YAML | Programmatic: self-describing typed YAML |
| \`raw-json\` | Bare JSON value (no envelope) | Backward compatibility with pre-0.5.0 scripts |
| \`raw-yaml\` | Bare YAML value (no envelope) | Backward compatibility with pre-0.5.0 scripts |

**Breaking change in v0.5.0**: Default output changed from bare JSON to \`text\`.
Scripts that parse uwf stdout as JSON must add \`--format raw-json\` (or \`--format json\`
and read from the \`.value\` field of the envelope).

## Common Pitfalls

**Agent loses workflow context in long sessions**: After many turns (100+), agents
may stop producing valid frontmatter output, causing the step to fail with
\`$status: "error"\` after retries. This happens when the agent's context window
overflows or when it loses track of the workflow's output schema requirements.
Recovery: \`resume\` → \`exec\` to re-enter with a fresh agent session.

**Resume on terminal-status threads loops to $END**: When a thread ended via a
terminal status (e.g. \`rejected → $END\`), \`resume\` resets \`done\` but the next
\`exec\` re-evaluates the same status and routes to \`$END\` again. Use \`poke\` to
replace the head step with new context that produces a different \`$status\`, or
start a fresh thread. See "Terminal-Status Threads" under Re-entry Patterns.

## Other Prompt References

For specific scenarios, run the corresponding \`uwf prompt\` command:

| Scenario | Command | When to use |
|----------|---------|-------------|
| Writing workflow YAML | \`uwf prompt workflow-authoring\` | Designing roles, graphs, and edge prompts |
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

### Migration: Removed Commands (v0.4.0)

| Old command | Replacement |
|-------------|-------------|
| \`uwf thread steps <tid>\` | \`uwf step list <tid>\` |
| \`uwf thread step-details <hash>\` | \`uwf step show <hash>\` |
| \`uwf thread fork <hash>\` | \`uwf step fork <hash>\` |
| \`uwf thread status <tid>\` | \`uwf thread show <tid>\` |

### Migration: Renamed Variables (v0.4.1)

| Old | New | Reason |
|-----|-----|--------|
| \`$body\` | \`_body\` | \`$\` prefix invalid in LiquidJS strict mode |

Edge prompts using \`{{ $body }}\` must change to \`{{ _body }}\`.
`;
}
