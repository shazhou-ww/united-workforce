// MAINTENANCE: This string must be kept in sync with the actual uwf CLI commands.
// Update whenever commands are added, removed, or their signatures change.
export function generateCliReference(): string {
  return `# uwf CLI Reference

## Setup

\`\`\`
uwf setup                          # interactive: pick the default agent
uwf setup --agent <name>           # non-interactive: set the default agent only
\`\`\`

Engine config is LLM-free — \`~/.uwf/config.yaml\` only stores
\`agents\`, \`defaultAgent\`, and \`agentOverrides\`. Each agent adapter loads its
own LLM configuration from a path it owns (e.g.
\`~/.uwf/agents/builtin.yaml\` for the builtin adapter).

## Workflow Commands

\`\`\`
uwf workflow add <file>           # register a workflow from YAML file
uwf workflow validate <file>      # validate a workflow YAML without registering it (CI-friendly)
uwf workflow show <id>            # show workflow by name or CAS hash
uwf workflow list                 # list workflows (auto-discovers .workflows/ from cwd upward + global registry)
\`\`\`

### Workflow Resolution

\`uwf thread start <workflow>\` and \`uwf workflow list\` both resolve the workflow
argument by searching from cwd upward. Strategies are tried in priority order:

1. **CAS hash** — a 13-char Crockford Base32 string is loaded directly from CAS.
2. **File path** — a relative or absolute \`.yaml\`/\`.yml\` path is materialized on the fly.
3. **Local \`.workflows/\` (cwd upward)** — \`uwf\` searches from cwd upward for the nearest
   directory containing \`.workflows/<name>.yaml\`, \`.workflows/<name>.yml\`,
   \`.workflows/<name>/index.yaml\`, or the legacy \`.workflow/\` (singular) variants
   as a fallback. \`workflow list\` uses the same cwd upward parent traversal so its
   output matches what \`thread start\` can resolve.
4. **Global registry** — \`uwf workflow add\` stores the workflow under
   \`@uwf/registry/<name>\` for system-wide resolution independent of cwd.

## Thread Commands

\`\`\`
uwf thread start <workflow> -p <prompt>           # create a thread (no execution)
uwf thread exec <thread-id>                       # execute one moderator→agent→extract cycle
               [--agent <alias|"host gw">]        # override agent (alias from agents map, or inline "<host> <gateway>" pair)
               [-c, --count <number>]             # run multiple steps (default: 1)
               [--background]                     # run in background
uwf thread show <thread-id>                       # show thread head pointer
uwf thread list                                   # list active threads (idle + running)
               [--all]                            # include end/cancelled/suspended
               [--status <status>]                # filter: idle, running, suspended, end, cancelled, active
uwf thread read <thread-id>                       # render thread context as markdown
               [--quota <chars>]                  # max output characters (default 32000)
               [--before <step-hash>]             # load steps before this hash (exclusive)
               [--start]                          # include start step in output
uwf thread stop <thread-id>                       # stop background execution (keep thread active)
uwf thread cancel <thread-id>                     # cancel thread (stop + move to history)
\`\`\`

## Step Commands

\`\`\`
uwf step list <thread-id>        # list all steps in a thread
uwf step show <step-hash>        # show details of a specific step
uwf step turns <thread-id>       # show ALL turns across a thread's steps (whole-chain panorama)
            [--role <role>]         # filter to one role's steps across the chain (default: all roles)
            [--live]                # follow the in-flight step (🔄 进行中), printing new turns as they arrive
            [--limit <n>]           # max turns from the flattened cross-step sequence (default: all)
            [--offset <n>]          # skip the first n turns of the flattened sequence
uwf step fork <step-hash>        # fork a thread from a specific step
\`\`\`

## CAS Commands

Use the \`ocas\` CLI for direct CAS operations (\`~/.ocas/\` store, shared with \`uwf\`):

\`\`\`
ocas get <hash>                # read a CAS node (type + payload)
            [--timestamp]         # include timestamp in output
ocas put <type-hash> <data>    # store a node, print its hash
                               # <data>: JSON file path or inline JSON string
ocas has <hash>                # check if a hash exists
ocas refs <hash>               # list direct CAS references from a node
ocas walk <hash>               # recursive traversal from a node
ocas reindex                   # rebuild type index from all CAS nodes
ocas schema list               # list all registered schemas
ocas schema get <hash>         # show a schema by its type hash
\`\`\`

## Log Commands

\`\`\`
uwf log list                      # list log files with sizes
uwf log show                      # show all log entries
           [--thread <thread-id>] # filter by thread ID
           [--process <pid>]      # filter by process ID
           [--date <YYYY-MM-DD>]  # filter by date
uwf log clean --before <date>     # delete log files before given date
\`\`\`

## Global Options

\`\`\`
uwf --format <fmt>                # output format: json (default) or yaml
uwf -V, --version                 # print version
\`\`\`

## Key Concepts

- **Workflow**: YAML definition with roles, conditions, and a routing graph; stored as a CAS node identified by its XXH64 hash.
- **Thread**: A running instance of a workflow; points to a chain of CAS step nodes.
- **Step**: One moderator→agent→extract cycle; stored as a CAS node with output + detail refs.
- **Turn**: Agent-internal interaction (within a single step); stored per-turn in the detail node.
- **CAS**: Content-addressable store; every artifact (workflows, steps, details, turns) is hashed.
`;
}
