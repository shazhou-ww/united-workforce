export function generateActorReference(): string {
  return `# Actor Reference

You are executing a workflow role. Your system prompt defines your goal, procedure, and output requirements. This reference covers two things you need to know about the workflow engine.

## 1. Frontmatter Output Protocol

Your response **MUST** begin with a YAML frontmatter block at byte position 0 — no preamble text before it.

\`\`\`
---
status: done
myField: some value
---

... markdown body (your work, explanation, notes) ...
\`\`\`

### Standard Field

| Field | Values | Default | Description |
|-------|--------|---------|-------------|
| \`status\` | \`done\`, \`needs_input\`, \`in_progress\`, \`failed\` | \`done\` | Completion signal — determines which graph edge the moderator follows next |

### Schema-Defined Fields

Your role's output schema (shown in the system prompt under "Deliverable Format") defines additional fields. Output **only** the fields listed there — do not invent extra fields.

### Body

Everything after the closing \`---\` fence is the markdown body. Use it for explanations, logs, or human-readable notes. The body is stored but not parsed by the engine.

### Retry

If the engine cannot parse your frontmatter, it will ask you to retry (up to 2 times). Just output the corrected frontmatter block — don't panic.

## 2. CAS (Content-Addressable Store)

Your frontmatter output is automatically stored in CAS. You can also **use CAS directly** via the \`ocas\` CLI to store intermediate artifacts, build merkle DAGs for large outputs, or reference data from previous steps.

### Commands

\`\`\`
ocas put <type-hash> <json>    # store typed JSON data, print hash
ocas get <hash>                # read a CAS node (type + payload)
ocas has <hash>                # check if a hash exists
ocas refs <hash>               # list direct references from a node
ocas walk <hash>               # recursive traversal from a node
ocas schema list               # list registered schemas
ocas schema get <hash>         # show a schema definition
\`\`\`

Plain-text storage for agent output is handled internally by the uwf pipeline — agents do not need to call \`ocas put\` for their deliverables.

### Merkle DAG Pattern

For large outputs, store parts individually and reference their hashes:

\`\`\`bash
# Store individual sections (use ocas put with the appropriate type hash)
HASH1=$(ocas put <type-hash> '"section 1 content"')
HASH2=$(ocas put <type-hash> '"section 2 content"')

# Reference hashes in your frontmatter or in a parent node
\`\`\`

This enables progressive loading — consumers can fetch the root and resolve children on demand.
`;
}
