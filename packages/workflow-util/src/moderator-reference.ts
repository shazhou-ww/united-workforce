export function generateModeratorReference(): string {
  return `# Moderator Reference

## Overview

The moderator is the workflow engine's routing component. It evaluates the directed graph defined in the workflow YAML to determine the next role (or \`$END\`) after each step — with zero LLM cost.

## Status-Based Routing

The moderator uses **status-based routing**: it inspects the previous step's extracted output (specifically the \`$status\` field and other output fields) and matches them against edge conditions in the graph.

### Routing Algorithm

1. Find all edges where \`from\` matches the current role
2. For each edge (in order), evaluate the \`when\` condition:
   - If \`when\` is absent → unconditional match (always taken)
   - If \`when\` is present → every key/value pair must match the step output
3. The first matching edge determines the next role
4. If no edge matches → thread stalls (error condition)

### Example

\`\`\`yaml
graph:
  - from: developer
    to: reviewer
    when:
      $status: done
  - from: developer
    to: $END
    when:
      $status: failed
  - from: reviewer
    to: developer
    when:
      $status: needs-changes
  - from: reviewer
    to: $END
    when:
      $status: approved
\`\`\`

In this graph:
- After \`developer\` produces \`$status: done\`, the moderator routes to \`reviewer\`
- After \`reviewer\` produces \`$status: needs-changes\`, it routes back to \`developer\`
- \`$status: failed\` or \`$status: approved\` terminates the thread

## Edge Evaluation Details

- Edges are evaluated **in declaration order** — put specific conditions before general ones
- \`when\` values are compared as **exact string matches**
- Multiple \`when\` fields are ANDed — all must match
- An edge without \`when\` acts as a **fallback** — place it last

## Integration with Steps

Each \`uwf thread exec\` cycle:
1. Moderator reads the thread's head step output
2. Evaluates graph edges to pick the next role
3. If next is \`$END\`, marks thread as completed
4. Otherwise, spawns the agent for the selected role
5. Extract pipeline parses agent output → new step node → append to CAS chain
`;
}
