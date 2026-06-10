# Specs

Behavior specifications for uwf CLI commands, in Given/When/Then format.

## Convention

Each spec is a **snapshot of current implementation behavior**. When the implementation changes, the corresponding spec must be updated to match.

Specs are not aspirational — they describe what the code **does**, not what it should do.

## Frontmatter Schema

Every spec file has YAML frontmatter with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `scenario` | string | One-line description of the behavior |
| `feature` | string | Which uwf command (`thread`, `workflow`, `step`, `config`) |
| `tags` | string[] | Categorization tags (e.g. `moderator`, `validate`, `graph`, `agent`) |

## File Naming

`<feature>-<behavior>.md` — e.g. `thread-start-from-yaml.md`, `workflow-validate-missing-edge.md`
