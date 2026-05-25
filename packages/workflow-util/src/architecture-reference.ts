export function generateArchitectureReference(): string {
  return `# Workflow Engine — Architecture Reference

## Key Concepts

### CAS (Content-Addressed Storage)
Every artifact in the workflow engine is stored as a CAS node — an immutable, content-addressed record identified by its XXH64 hash (13-char Crockford Base32). CAS provides deduplication, integrity verification, and an append-only audit trail.

Stored artifacts include:
- **Workflow definitions** — the YAML-parsed payload
- **Step nodes** — each moderator→agent→extract cycle
- **Detail nodes** — per-step metadata and turn history
- **Turn records** — individual agent interactions within a step

### Thread
A Thread is a single execution of a Workflow, identified by a ULID (26-char Crockford Base32: 10 timestamp + 16 random). Thread state is an immutable CAS chain — each step points to its predecessor via a \`prev\` hash, forming a linked list.

Active threads are indexed in \`threads.yaml\`; completed threads move to \`history.jsonl\`.

A thread progresses by running \`uwf thread exec\`, which performs one moderator→agent→extract cycle per step.

### Workflow
A Workflow is a YAML definition (\`WorkflowPayload\`) stored as a CAS node. It defines:
- **Roles** — named actors with system prompts and output schemas
- **Graph** — status-based routing edges between roles
- **Conditions** — edge predicates evaluated by the moderator

Workflow names follow verb-first kebab-case: \`solve-issue\`, \`review-code\`.

### Step
A Step is one moderator→agent→extract cycle, stored as a CAS node (\`StepNodePayload\`). Each step contains:
- **output** — the agent's extracted frontmatter output
- **detail** — a CAS reference to turn-level records
- **prev** — CAS hash of the previous step (forming the chain)
- **role** — which role produced this step

### Turn
A Turn is an agent-internal interaction within a single Step. Turns are stored per-turn in the detail node, capturing the raw agent I/O before extraction.

## Data Flow

\`\`\`
uwf thread exec <thread-id>
  → Moderator evaluates graph edges based on current status
  → Selects next role (or $END)
  → Agent CLI is spawned with context
  → Agent produces frontmatter markdown
  → Extract pipeline parses output into structured data
  → New CAS step node is appended to the thread chain
\`\`\`

## Storage Layout

All data lives under \`~/.uncaged/workflow/\`:
- \`cas/\` — content-addressed store (XXH64-keyed)
- \`threads.yaml\` — active thread index
- \`history.jsonl\` — completed thread archive
- \`registry.yaml\` — workflow name → CAS hash mapping
`;
}
