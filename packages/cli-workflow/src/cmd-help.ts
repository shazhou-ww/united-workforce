export function formatSkillDoc(): string {
  return `# uncaged-workflow CLI Reference

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Workflow** | A single-file ESM bundle (\`.esm.js\`) that exports \`run\` and \`descriptor\`. Identified by name and XXH64 hash. |
| **Bundle** | The physical \`.esm.js\` file stored in the bundles directory. Immutable once written. |
| **Thread** | A single execution of a workflow, identified by a ULID. Persists state as JSONL files. |
| **CAS** | Content-Addressable Storage. Per-thread key-value store keyed by content hash. |
| **Registry** | \`workflow.yaml\` — maps workflow names to their current and historical bundle hashes. |

## Commands

### workflow

| Command | Args | Description |
|---------|------|-------------|
| \`workflow add\` | \`<name> <file.esm.js> [--types <path>]\` | Register a workflow bundle in the registry |
| \`workflow list\` | (none) | List all registered workflows |
| \`workflow show\` | \`<name>\` | Show details of a registered workflow |
| \`workflow rm\` | \`<name>\` | Remove a workflow from the registry |
| \`workflow history\` | \`<name>\` | Show version history of a workflow |
| \`workflow rollback\` | \`<name> [hash]\` | Rollback a workflow to a previous version |

### thread

| Command | Args | Description |
|---------|------|-------------|
| \`thread run\` | \`<name> [--prompt <text>] [--max-rounds N]\` | Start a new thread executing a workflow |
| \`thread list\` | \`[name]\` | List threads, optionally filtered by workflow name |
| \`thread show\` | \`<id>\` | Show thread details and state |
| \`thread rm\` | \`<id>\` | Remove a thread |
| \`thread fork\` | \`<thread-id> [--from-role <role>]\` | Fork a thread, optionally from a specific role |
| \`thread ps\` | (none) | List running threads |
| \`thread kill\` | \`<thread-id>\` | Kill a running thread |
| \`thread live\` | \`<thread-id> [--debug] [--role <name>]\` or \`--latest [--debug] [--role <name>]\` | Attach to a thread and stream output live |
| \`thread pause\` | \`<thread-id>\` | Pause a running thread |
| \`thread resume\` | \`<thread-id>\` | Resume a paused thread |

### cas

| Command | Args | Description |
|---------|------|-------------|
| \`cas get\` | \`<thread-id> <hash>\` | Retrieve content by hash from a thread's CAS |
| \`cas put\` | \`<thread-id> <content>\` | Store content in a thread's CAS, returns hash |
| \`cas list\` | \`<thread-id>\` | List all CAS entries for a thread |
| \`cas rm\` | \`<thread-id> <hash>\` | Remove a CAS entry |
| \`cas gc\` | (none) | Garbage-collect unreferenced CAS entries |

### init

| Command | Args | Description |
|---------|------|-------------|
| \`init workspace\` | \`<name>\` | Initialize a new workflow workspace |
| \`init template\` | \`<name>\` | Initialize a new workflow template |

### Top-level shortcuts

| Command | Equivalent | Description |
|---------|------------|-------------|
| \`run\` | \`thread run\` | Shortcut to start a thread |
| \`live\` | \`thread live\` | Shortcut to attach to a thread |

## Typical Workflow

1. \`uncaged-workflow workflow add my-wf ./my-wf.esm.js\` — register a workflow
2. \`uncaged-workflow run my-wf --prompt "do the thing"\` — start a thread
3. \`uncaged-workflow live --latest\` — attach and watch output
4. \`uncaged-workflow thread show <thread-id>\` — inspect completed thread

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error |

## Environment Variables

| Variable | Description |
|----------|-------------|
| \`UNCAGED_WORKFLOW_STORAGE_ROOT\` | Override the default storage directory for all workflow data |
`;
}
