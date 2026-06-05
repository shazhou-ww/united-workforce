export function generateYamlReference(): string {
  return `# Workflow YAML Schema Reference

## Top-Level Structure

A workflow YAML file defines the complete workflow specification:

\`\`\`yaml
name: solve-issue          # verb-first kebab-case identifier
description: "..."         # human-readable description

roles:                     # named actors in the workflow
  planner:
    description: "Analyzes issue and outputs a plan"
    goal: "You are a planning agent."
    capabilities:
      - issue-analysis
      - planning
    procedure: |
      1. Read the issue
      2. Produce a test spec
    output: "Output the plan summary. Set $status to ready or insufficient_info."
    frontmatter:           # JSON Schema for structured output (drives routing)
      oneOf:
        - properties:
            $status: { const: ready }
            plan: { type: string }
          required: [$status, plan]
        - properties:
            $status: { const: insufficient_info }
          required: [$status]

graph:                     # status-based routing (nested map)
  $START:
    new: { role: planner, prompt: "Analyze the issue." }
    resume: { role: planner, prompt: "Review the previous run output and continue." }
  planner:
    ready: { role: developer, prompt: "Implement plan {{{plan}}}." }
    insufficient_info: { role: $END, prompt: "Not enough info." }
\`\`\`

## roles

Each role defines an actor in the workflow:

| Field | Type | Description |
|-------|------|-------------|
| \`description\` | string | Short description of the role's purpose |
| \`goal\` | string | System-level goal statement for the agent |
| \`capabilities\` | string[] | Tags describing what the role can do |
| \`procedure\` | string | Step-by-step instructions for the agent |
| \`output\` | string | Description of expected output format |
| \`frontmatter\` | JSON Schema | Defines the structured output the agent must produce |

### frontmatter

The \`frontmatter\` field is a standard JSON Schema object. The extract pipeline validates agent output against it. Key conventions:
- \`$status\` field drives routing decisions in the graph
- Use \`const\` or \`enum\` to constrain status values
- Use \`oneOf\` to define multiple valid output shapes (one per status)
- All \`required\` fields must appear in the agent's frontmatter output

## graph

The graph is a nested map defining status-based routing:

\`\`\`
Record<Role | "$START", Record<Status, { role: string, prompt: string }>>
\`\`\`

| Level | Key | Value |
|-------|-----|-------|
| Outer | Role name or \`$START\` | Status map for that role |
| Inner | \`$status\` value | Target: \`{ role, prompt }\` |

### Special Nodes
- \`$START\` — entry point; uses status keys \`new\` (first start) and \`resume\` (resuming a completed thread)
- \`$END\` — terminal node; thread completes when reached

### Edge Prompts
Prompts use triple-brace Mustache templates (\`{{{field}}}\`) to interpolate values from the previous step's output. Example: \`"Implement plan {{{plan}}} in repo {{{repoPath}}}."\`
`;
}
