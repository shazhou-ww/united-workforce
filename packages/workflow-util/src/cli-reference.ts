// MAINTENANCE: This string must be kept in sync with the actual uwf CLI commands.
// Update whenever commands are added, removed, or their signatures change.
export function generateCliReference(): string {
  return `# uwf CLI Reference

## Setup

\`\`\`
uwf setup                                         # interactive setup wizard
uwf setup --provider <name> --base-url <url> \\
           --api-key <key> --model <name>          # non-interactive setup
           [--agent <name>]                        # optional: default agent alias
\`\`\`

## Workflow Commands

\`\`\`
uwf workflow put <file>           # register a workflow from YAML file
uwf workflow show <id>            # show workflow by name or CAS hash
uwf workflow list                 # list all registered workflows
\`\`\`

## Thread Commands

\`\`\`
uwf thread start <workflow> -p <prompt>           # create a thread (no execution)
uwf thread step <thread-id>                       # execute one moderator→agent→extract cycle
               [--agent <cmd>]                    # override agent command
uwf thread show <thread-id>                       # show thread head pointer
uwf thread list                                   # list active threads
               [--all]                            # include archived threads
uwf thread kill <thread-id>                       # terminate and archive a thread
uwf thread steps <thread-id>                      # list all steps in a thread
uwf thread read <thread-id>                       # render thread context as markdown
               [--quota <chars>]                  # max output characters (default 32000)
               [--before <step-hash>]             # load steps before this hash (exclusive)
               [--start]                          # include start step in output
uwf thread fork <step-hash>                       # fork a thread from a specific step
uwf thread step-details <step-hash>               # dump full detail node of a step as YAML
\`\`\`

## CAS Commands

\`\`\`
uwf cas get <hash>                # read a CAS node (type + payload)
            [--timestamp]         # include timestamp in output
uwf cas put <type-hash> <data>    # store a node, print its hash
                                  # <data>: JSON file path or inline JSON string
uwf cas put-text <text>           # store a plain text string, print its hash
                                  # shortcut for put with the built-in text schema
uwf cas has <hash>                # check if a hash exists
uwf cas refs <hash>               # list direct CAS references from a node
uwf cas walk <hash>               # recursive traversal from a node
uwf cas reindex                   # rebuild type index from all CAS nodes
uwf cas schema list               # list all registered schemas
uwf cas schema get <hash>         # show a schema by its type hash
\`\`\`

## Global Options

\`\`\`
uwf --format <fmt>                # output format: json (default) or yaml
uwf -V, --version                 # print version
\`\`\`

## Key Concepts

- **Workflow**: YAML definition with roles, conditions, and a routing graph; stored as a CAS node identified by its XXH64 hash.
- **Thread**: A single workflow execution (ULID). State is an immutable CAS chain; active threads are indexed in \`threads.yaml\`.
- **Step**: One moderator→agent→extract cycle. Run \`uwf thread step\` repeatedly until \`$END\`.
- **CAS**: Content-Addressed Storage — all nodes are immutable and identified by hash.
- **Role**: Named actor with goal, capabilities, procedure, output, and meta; the moderator routes between roles.
`;
}
