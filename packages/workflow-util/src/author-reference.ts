export function generateAuthorReference(): string {
  return `# Author Reference

Guide for designing and writing workflow YAML definitions.

## Workflow Structure

\`\`\`yaml
name: solve-issue              # verb-first kebab-case
description: "..."             # human-readable summary

roles:                         # named actors
  planner:
    description: "..."         # short purpose
    goal: "..."                # system-level goal for the agent
    capabilities: [...]        # skill keywords the agent should load
    procedure: |               # step-by-step instructions
      1. Do this
      2. Do that
    output: "..."              # what the agent should produce
    frontmatter:               # JSON Schema for structured output
      oneOf:
        - properties:
            $status: { const: "ready" }
            plan: { type: string }
          required: [$status, plan]
        - properties:
            $status: { const: "failed" }
            error: { type: string }
          required: [$status, error]

graph:                         # status-based routing
  $START:
    _: { role: planner, prompt: "Analyze the issue." }
  planner:
    ready: { role: developer, prompt: "Implement {{{plan}}}." }
    failed: { role: $END, prompt: "Failed: {{{error}}}" }
\`\`\`

## Role Definition

| Field | Purpose |
|-------|---------|
| \`description\` | Short description for humans and moderator context |
| \`goal\` | Injected as the agent's system-level objective |
| \`capabilities\` | Keyword tags — agent loads matching skills before starting |
| \`procedure\` | Step-by-step instructions the agent follows |
| \`output\` | Describes what to produce and which \`$status\` values to use |
| \`frontmatter\` | JSON Schema defining the structured output fields |

### Role Design Principles

- **Single responsibility** — each role does one thing well
- **Minimal context** — don't overload a role with too many steps; split if needed
- **Clear status values** — each status should map to a distinct graph edge
- **Explicit output** — tell the agent exactly what \`$status\` values are valid

## Frontmatter Schema

The \`frontmatter\` field is a standard JSON Schema. It defines the structured fields the agent must output in YAML frontmatter.

### \`$status\` Field

\`$status\` is the only standard field. Its value determines which graph edge the moderator follows. Use \`const\` to constrain each variant:

\`\`\`yaml
frontmatter:
  oneOf:
    - properties:
        $status: { const: "done" }
        result: { type: string }
      required: [$status, result]
    - properties:
        $status: { const: "failed" }
        error: { type: string }
      required: [$status, error]
\`\`\`

### Custom Fields

Add any fields you need for data passing between roles. These are available in edge prompts via Mustache templates.

### Flat Schema (Single Status)

When a role has only one outcome:

\`\`\`yaml
frontmatter:
  properties:
    $status: { const: "done" }
    summary: { type: string }
  required: [$status, summary]
\`\`\`

## Graph Routing

The graph maps each role's \`$status\` values to the next role:

\`\`\`
graph[role][$status] → { role: nextRole, prompt: edgePrompt }
\`\`\`

### Special Nodes

| Node | Purpose |
|------|---------|
| \`$START\` | Entry point — status key is always \`_\` (unconditional) |
| \`$END\` | Terminal — thread completes and is archived |

### Edge Prompts

Use triple-brace Mustache (\`{{{field}}}\`) to pass data from the previous step's output:

\`\`\`yaml
graph:
  planner:
    ready: { role: developer, prompt: "Implement plan {{{plan}}} in {{{repoPath}}}." }
\`\`\`

The fields referenced must exist in the source role's frontmatter schema.

### Loops and Branching

Roles can route back to previous roles (loops) or to different roles based on status (branching):

\`\`\`yaml
graph:
  reviewer:
    approved: { role: tester, prompt: "Run tests." }
    rejected: { role: developer, prompt: "Fix: {{{comments}}}" }  # loop back
\`\`\`

### Fail Routing

Route failures to a cleanup role or \`$END\`:

\`\`\`yaml
graph:
  developer:
    done: { role: reviewer, prompt: "Review changes." }
    failed: { role: cleanup, prompt: "Clean up: {{{error}}}" }
\`\`\`

## Self-Testing

### Step-by-Step Verification

\`\`\`bash
# Start a thread directly from YAML file (no registration needed)
uwf thread start my-workflow.yaml -p "Test prompt"

# Or register first, then start by name
uwf workflow add my-workflow.yaml
uwf thread start my-workflow -p "Test prompt"

# Execute one step at a time to verify routing
uwf thread exec <thread-id>

# Inspect step output
uwf step list <thread-id>
uwf step show <step-hash>

# Check the CAS data
uwf cas get <output-hash>
\`\`\`

### Validation Checklist

1. Every \`$status\` value in a role's frontmatter has a matching edge in the graph
2. Every field referenced in edge prompts (\`{{{field}}}\`) exists in the source role's schema
3. Every role referenced in the graph exists in \`roles\`
4. \`$START\` has exactly one edge with key \`_\`
5. At least one path leads to \`$END\`
6. No orphan roles (defined but never routed to)

## Common Pitfalls

- **Missing graph edge** — if a role can produce \`$status: failed\` but the graph has no \`failed\` edge, the moderator will error
- **Mustache field mismatch** — referencing \`{{{branch}}}\` in an edge prompt but the source schema has \`branchName\` instead
- **Overly complex roles** — a role with 20 steps should be split; each role should be completable in one agent turn
- **No fail path** — always handle failure; route to cleanup or \`$END\`
`;
}
