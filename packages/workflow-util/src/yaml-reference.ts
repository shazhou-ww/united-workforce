export function generateYamlReference(): string {
  return `# Workflow YAML Schema Reference

## Top-Level Structure

A workflow YAML file defines the complete workflow specification:

\`\`\`yaml
name: solve-issue          # verb-first kebab-case identifier
description: "..."         # human-readable description

roles:                     # named actors in the workflow
  planner:
    system: |              # system prompt for the agent
      You are a planner...
    outputSchema:          # JSON Schema for structured output
      type: object
      required: [plan, $status]
      properties:
        plan:
          type: string
        $status:
          type: string
          enum: [ready, failed]

graph:                     # status-based routing edges
  - from: $START
    to: planner
  - from: planner
    to: developer
    when:
      $status: ready
  - from: planner
    to: $END
    when:
      $status: failed
\`\`\`

## roles

Each role defines an actor in the workflow:

| Field | Type | Description |
|-------|------|-------------|
| \`system\` | string | System prompt — instructions for the agent |
| \`outputSchema\` | JSON Schema | Defines the structured output the agent must produce |
| \`agent\` | string (optional) | Override the default agent command for this role |

### outputSchema

The \`outputSchema\` is a standard JSON Schema object. The extract pipeline validates agent output against it. Key conventions:
- \`$status\` field drives routing decisions in the graph
- Use \`enum\` to constrain status values
- All required fields must appear in the agent's frontmatter output

## graph

The graph is an array of directed edges defining status-based routing:

| Field | Type | Description |
|-------|------|-------------|
| \`from\` | string | Source role name, or \`$START\` |
| \`to\` | string | Target role name, or \`$END\` |
| \`when\` | object | Condition map — field/value pairs to match against previous output |

### Special Nodes
- \`$START\` — entry point, must have exactly one outgoing edge
- \`$END\` — terminal node, thread completes when reached

### Edge Evaluation
Edges are evaluated in order. The first edge whose \`when\` condition matches the current step output is selected. If no \`when\` is specified, the edge is unconditional (always matches).
`;
}
