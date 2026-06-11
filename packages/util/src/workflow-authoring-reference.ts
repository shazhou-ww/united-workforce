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
      3. If stuck, output $status: "$SUSPEND" with a reason
    output: "..."              # what the agent should produce
    frontmatter:               # JSON Schema for structured output
      type: object
      properties:
        $status: { const: "ready" }
        plan: { type: string }
      required: [$status, plan]

graph:                         # status-based routing
  $START:
    new: { role: planner, prompt: "Analyze the issue." }
    resume: { role: planner, prompt: "Review the previous run output and continue." }
  planner:
    ready: { role: developer, prompt: "Implement {{ plan }}." }
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
  oneOf:
    - properties:
        $status: { const: "done" }
        result: { type: string }
      required: [$status, result]
    - properties:
        $status: { const: "rejected" }
        comments: { type: string }
      required: [$status, comments]
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
- For **flat schemas**, declare \`type: object\` at the top level alongside \`properties\`
- For **oneOf schemas**, do NOT add a sibling \`type: object\` — each variant declares its own \`properties\` and \`required\`
- \`$status\` always uses \`const: "value"\` — simple and consistent
- \`enum\` is **not supported** for \`$status\` — the validator will reject it

### Custom Fields

Add any fields you need for data passing between roles. These are available in edge prompts via Liquid templates.

## Graph Routing

The graph maps each role's \`$status\` values to the next role:

\`\`\`
graph[role][$status] → { role: nextRole, prompt: edgePrompt }
\`\`\`

### Special Nodes

| Node | Purpose |
|------|---------|
| \`$START\` | Entry point — status keys \`new\` (first start) and \`resume\` (\`uwf thread resume\` on an **ended** thread re-enters the workflow here) |
| \`$END\` | Terminal — thread completes and is archived |

**Important:** \`$START.resume\` is only triggered when resuming an **ended** thread. Resuming a **suspended** thread does NOT use \`$START.resume\` — it re-runs the suspended role directly with its original prompt. These are completely different code paths.

### Edge Prompts

Use Liquid \`{{ field }}\` syntax to pass data from the previous step's output:

\`\`\`yaml
graph:
  planner:
    ready: { role: developer, prompt: "Implement plan {{ plan }} in {{ repoPath }}." }
\`\`\`

The fields referenced must exist in the source role's frontmatter schema.

#### The \`_body\` Variable

Edge prompts can access \`{{ _body }}\` — the markdown body (after frontmatter) from the previous step's output. This is useful when you want the full prose response, not just the structured frontmatter fields:

\`\`\`yaml
graph:
  thinker:
    respond:
      role: questioner
      prompt: "The thinker says:\\n\\n{{ _body }}\\n\\nAsk a probing question."
\`\`\`

\`_body\` is automatically injected by the engine. It strips the \`---...---\` frontmatter block and returns the remaining content. If there is no body, it resolves to an empty string.

### Liquid Template Capabilities

Edge prompts use the [LiquidJS](https://liquidjs.com/) engine, which supports filters and loops beyond simple field interpolation.

#### Filters

Transform values inline using the pipe (\`|\`) syntax:

\`\`\`yaml
graph:
  planner:
    ready:
      role: developer
      prompt: "Fix the following files: {{ files | join: \\", \\" }}"
\`\`\`

Common filters: \`join\`, \`size\`, \`upcase\`, \`downcase\`, \`strip\`, \`default\`.

#### Loops

Iterate over arrays using \`{% for %}\` blocks:

\`\`\`yaml
graph:
  planner:
    ready:
      role: developer
      prompt: |
        Implement the following tasks:
        {% for task in tasks %}- {{ task }}
        {% endfor %}
\`\`\`

These capabilities are available because the engine uses LiquidJS — simple \`{{ field }}\` interpolation works for most cases, but filters and loops are available when edge prompts need to format complex data.

### Loops and Branching

Roles can route back to previous roles (loops) or to different roles based on status (branching):

\`\`\`yaml
graph:
  reviewer:
    approved: { role: tester, prompt: "Run tests." }
    rejected: { role: developer, prompt: "Fix: {{ comments }}" }  # loop back
\`\`\`

### Failure Handling — Use \`$SUSPEND\`, Not \`failed → $END\`

**Design principle: workflow graphs should only contain forward paths and retry loops — never \`failed → $END\`.**

Failure is an exception that requires human intervention, not a normal workflow exit. When a role cannot proceed:

1. The role emits \`$status: "$SUSPEND"\` with a \`reason\` explaining what went wrong
2. The engine pauses the thread in \`suspended\` state
3. A human reviews the situation and resumes with \`uwf thread resume <id> -p "..."\`

This preserves all prior work in the thread — compared to \`failed → $END\` which terminates the thread and loses the ability to continue.

**Status categories:**
- ✅ Forward: \`done\`, \`ready\`, \`approved\`, \`passed\`, \`merged\`
- 🔁 Retry: \`rejected\`, \`fix_code\`, \`fix_spec\`
- ⏸ Pause: \`$SUSPEND\` (engine-level, not a graph edge)

\`\`\`yaml
# ✅ Correct — only forward path; failure suspends for human
roles:
  developer:
    procedure: |
      If you cannot complete the task, output $status: "$SUSPEND" with reason.
    frontmatter:
      type: object
      properties:
        $status: { const: "done" }
        summary: { type: string }
      required: [$status, summary]
graph:
  developer:
    done: { role: reviewer, prompt: "Review changes." }

# ❌ Wrong — failed terminates the thread, losing all prior work
graph:
  developer:
    done: { role: reviewer, prompt: "Review changes." }
    failed: { role: $END, prompt: "Failed: {{ error }}" }
\`\`\`

### Cross-cwd Execution

Each step runs in a working directory resolved by the cwd inheritance chain:

1. \`--cwd <path>\` — CLI flag on \`uwf thread start\`, captured into \`StartNodePayload.cwd\` (defaults to \`process.cwd()\`). This is the thread's base working directory and the fallback for every step.
2. \`Target.location\` — per-edge working directory override using a Liquid template (e.g. \`{{ repoPath }}\`); rendered by the moderator against the previous step's frontmatter output. When set, the rendered path becomes the new \`StepRecord.cwd\`.
3. \`StepRecord.cwd\` — the final per-step working directory persisted on the step node and used by the agent that runs it.

Each edge's \`location\` override applies per-step only — when the next edge omits \`location\` (or sets it to \`null\`), the step reverts to the thread's start cwd, not the previously overridden one.

### Edge Target Fields

Each graph edge target supports three fields:

| Field | Purpose |
|-------|---------|
| \`role\` | The next role to execute, or a pseudo-role such as \`$END\` |
| \`prompt\` | Liquid template rendered against the previous step's frontmatter |
| \`location\` | Optional working directory override — a Liquid template (e.g. \`{{ repoPath }}\`); falls back to the thread's start cwd (\`StartNodePayload.cwd\`) when \`null\` or omitted |

#### Cross-repo dispatch example

A \`cloner\` role checks out a different repository; the downstream \`developer\` step then runs inside the freshly cloned working directory:

\`\`\`yaml
roles:
  cloner:
    description: "Clone a repository"
    goal: "Clone the target repo and report its absolute path"
    capabilities: [git]
    procedure: |
      1. git clone the URL into a fresh directory
      2. Output the absolute path as repoPath
    output: "ready with repoPath"
    frontmatter:
      type: object
      properties:
        $status: { const: "ready" }
        repoPath: { type: string }
      required: [$status, repoPath]

  developer:
    description: "Implement a change inside the cloned repo"
    goal: "Run the developer procedure inside the cloned working directory"
    capabilities: [coding]
    procedure: |
      1. Inspect the working directory
      2. Apply the requested change
    output: "done with summary"
    frontmatter:
      type: object
      properties:
        $status: { const: "done" }
        summary: { type: string }
      required: [$status, summary]

graph:
  $START:
    new: { role: cloner, prompt: "Clone {{ repoUrl }}.", location: null }
  cloner:
    ready:
      role: developer
      prompt: "Implement the change in {{ repoPath }}."
      location: "{{ repoPath }}"
  developer:
    done: { role: $END, prompt: "{{ summary }}", location: null }
\`\`\`

The \`cloner\` step runs in the thread's start cwd; the \`developer\` edge sets \`location: "{{ repoPath }}"\`, so the moderator renders the cloner's \`repoPath\` field and the developer agent runs inside that newly cloned directory — dispatching across different repos within a single thread.

#### Path resolution

\`location\` values are used as-is after Liquid rendering — no additional path resolution is applied.

- **Absolute paths** — used directly (e.g. \`/home/user/repos/my-project\`)
- **Relative paths** — resolved by Node.js against the thread's start cwd (\`StartNodePayload.cwd\`), not the current step's cwd

In practice, use absolute paths (typically rendered from a previous step's frontmatter) to avoid ambiguity.

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

### Engine-Level Errors

If the agent crashes or frontmatter extraction fails after all retries, the engine records the step with
\`$status: "error"\` — distinct from any role-defined status. Engine errors are **not routable** in the graph;
the thread stops at the failed step and requires manual intervention (\`thread poke\` or \`thread exec\` to retry).

On successful retry, the new step carries a \`previousAttempts\` array referencing prior failed step hashes.
This forms a complete retry lineage visible via \`uwf step show\`.

Agent adapters may also emit \`$SUSPEND\` autonomously when hitting resource limits (token budget, context window).
Design roles to be resumable even if the role procedure does not explicitly mention suspension.

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
searching from cwd upward, stopping at the nearest \`.git\` boundary (repository root).
You can run the command from any subdirectory of the project. \`uwf workflow list\` uses
the same parent traversal, so its output matches what \`thread start\` can resolve.
No workflow add registration needed — \`uwf workflow add\` is only required for global,
cwd-independent registration.

Folder-based layouts also work — \`.workflows/<name>/index.yaml\` (or \`index.yml\`) is
discovered as workflow \`<name>\`. The legacy \`.workflow/\` (singular) directory
remains supported as a fallback when \`.workflows/\` is absent.

## Validation

Validate workflow YAML before committing or in CI:

\`\`\`bash
uwf workflow validate my-workflow.yaml
\`\`\`


Checks include JSON Schema conformance, graph edge completeness, Liquid template field references,
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
2. Every field referenced in edge prompts (\`{{ field }}\`) exists in the source role's schema
3. Every role referenced in the graph exists in \`roles\`
4. \`$START\` has edges with keys \`new\` and \`resume\`
5. At least one path leads to \`$END\`
6. No orphan roles (defined but never routed to)

## Common Pitfalls

- **Missing graph edge** — if a role can produce a \`$status\` value but the graph has no matching edge, the moderator will error
- **Template field mismatch** — referencing \`{{ branch }}\` in an edge prompt but the source schema has \`branchName\` instead
- **Overly complex roles** — a role with 20 steps should be split; each role should be completable in one agent turn
- **\`failed → $END\` anti-pattern** — never route failure to \`$END\`; use \`$SUSPEND\` so work is preserved and humans can intervene
`;
}
