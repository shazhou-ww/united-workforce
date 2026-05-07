import { getCommandRegistry } from "./cli-dispatch.js";

export function formatSkillDoc(): string {
  const groups = getCommandRegistry();

  const commandSections: string[] = [];
  for (const group of groups) {
    const rows = group.commands.map((cmd) => {
      const args = cmd.args ? `\`${cmd.args}\`` : "(none)";
      return `| \`${group.name} ${cmd.name}\` | ${args} | ${cmd.description} |`;
    });
    commandSections.push(
      `### ${group.name}\n\n| Command | Args | Description |\n|---------|------|-------------|\n${rows.join("\n")}`,
    );
  }

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

${commandSections.join("\n\n")}

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
