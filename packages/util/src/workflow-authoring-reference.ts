import { VERSION } from "./version.js";

export function generateWorkflowAuthoringReference(): string {
  return `---
name: uwf-workflow-authoring
description: "Guide for designing and writing workflow YAML definitions."
version: ${VERSION}
tags: [uwf, workflow, yaml, authoring]
---

# Workflow Authoring Reference

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
      type: object
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
    new: { role: planner, prompt: "Analyze the issue." }
    resume: { role: planner, prompt: "Review the previous run output and continue." }
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

\`$status\` is the only standard field. Its value determines which graph edge the moderator follows.

**Multi-exit (oneOf)** — use \`const\` to constrain each variant:

\`\`\`yaml
frontmatter:
  type: object
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

**Single-exit (flat schema)** — same syntax, just no \`oneOf\` wrapper:

\`\`\`yaml
frontmatter:
  type: object
  properties:
    $status: { const: "done" }
    summary: { type: string }
  required: [$status, summary]
\`\`\`

**Important rules:**
- \`type: object\` is **required** at the top level of frontmatter (both flat and oneOf)
- \`$status\` always uses \`const: "value"\` — simple and consistent
- \`enum\` is **not supported** for \`$status\` — the validator will reject it

### Custom Fields

Add any fields you need for data passing between roles. These are available in edge prompts via Mustache templates.

## Graph Routing

The graph maps each role's \`$status\` values to the next role:

\`\`\`
graph[role][$status] → { role: nextRole, prompt: edgePrompt }
\`\`\`

### Special Nodes

| Node | Purpose |
|------|---------|
| \`$START\` | Entry point — status keys \`new\` (first start) and \`resume\` (resuming an ended thread) |
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

## Suspend (\`$SUSPEND\`)

\`$SUSPEND\` is an engine-level coroutine yield — **not** a graph target. Any role may emit it
from its output to pause the thread until external input arrives.

### SuspendOutput

When a role yields, it emits this reserved output shape (validated against \`SuspendOutput\`,
not the role's own frontmatter schema):

\`\`\`yaml
---
$status: "$SUSPEND"
reason: "Waiting for human approval on PR #42"
---
\`\`\`

| Field | Purpose |
|-------|---------|
| \`$status\` | Must be the literal \`"$SUSPEND"\` |
| \`reason\` | Human-readable explanation of why the thread paused |

The engine intercepts \`$SUSPEND\` before the moderator: the step is written to CAS, the thread
status becomes \`suspended\`, and routing stops. \`uwf thread resume\` re-runs the **same role**
with its original prompt plus an optional supplementary prompt (\`-p\`).

### Design Guidelines

- Do **not** add \`$SUSPEND\` as a graph edge target — \`role: "$SUSPEND"\` fails validation
- Do **not** declare \`$SUSPEND\` in the role's frontmatter schema — it is engine-reserved
- Use suspend when a role needs human input, external approval, or a long-running async result
- Pair with clear \`reason\` text so operators know what to provide before resuming

### Example

\`\`\`yaml
roles:
  planner:
    description: "Plan the implementation"
    goal: "Produce a plan or request missing info"
    capabilities: []
    procedure: |
      1. Analyze the prompt
      2. If info is missing, emit $status "$SUSPEND" with a reason
      3. Otherwise output $status ready with the plan
    output: "ready with plan, or $SUSPEND with reason if blocked"
    frontmatter:
      type: object
      properties:
        $status: { const: "ready" }
        plan: { type: string }
      required: [$status, plan]

graph:
  $START:
    new: { role: planner, prompt: "Analyze the task." }
    resume: { role: planner, prompt: "Continue with the provided info." }
  planner:
    ready: { role: $END, prompt: "Done." }
\`\`\`

When the planner emits \`$SUSPEND\`, the operator runs \`uwf thread resume <id> -p "Here is the missing info"\`
and the planner role runs again with the supplement appended to its prompt.

## Placement

Drop your workflow YAML under a project-local \`.workflows/\` directory at (or above)
your repo root:

\`\`\`
my-project/
  .workflows/
    solve-issue.yaml
    review-code.yaml
\`\`\`

\`uwf thread start solve-issue\` will auto-discover \`.workflows/solve-issue.yaml\` by
searching from cwd upward — you can run the command from any subdirectory of the
project. \`uwf workflow list\` uses the same parent traversal, so its output
matches what \`thread start\` can resolve. No workflow add registration needed —
\`uwf workflow add\` is only required for global, cwd-independent registration.

Folder-based layouts also work — \`.workflows/<name>/index.yaml\` (or \`index.yml\`) is
discovered as workflow \`<name>\`. The legacy \`.workflow/\` (singular) directory
remains supported as a fallback when \`.workflows/\` is absent.

## Validation

Validate workflow YAML before committing or in CI:

\`\`\`bash
uwf workflow validate my-workflow.yaml
\`\`\`


Checks include JSON Schema conformance, graph edge completeness, Mustache field references,
and reserved-name rules (e.g. \`$SUSPEND\` is not a valid graph target).

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
ocas get <output-hash>
\`\`\`

### Validation Checklist

1. Every \`$status\` value in a role's frontmatter has a matching edge in the graph
2. Every field referenced in edge prompts (\`{{{field}}}\`) exists in the source role's schema
3. Every role referenced in the graph exists in \`roles\`
4. \`$START\` has edges with keys \`new\` and \`resume\`
5. At least one path leads to \`$END\`
6. No orphan roles (defined but never routed to)

## Common Pitfalls

- **Missing graph edge** — if a role can produce \`$status: failed\` but the graph has no \`failed\` edge, the moderator will error
- **Mustache field mismatch** — referencing \`{{{branch}}}\` in an edge prompt but the source schema has \`branchName\` instead
- **Overly complex roles** — a role with 20 steps should be split; each role should be completable in one agent turn
- **No fail path** — always handle failure; route to cleanup or \`$END\`
`;
}
