import { getCommandRegistry } from "./cli-dispatch.js";

type SkillTopic = {
  name: string;
  description: string;
  format: () => string;
};

const SKILL_TOPICS: ReadonlyArray<SkillTopic> = [
  { name: "cli", description: "Full CLI command reference", format: formatSkillCli },
  {
    name: "develop",
    description: "Guide for agents executing roles inside a workflow",
    format: formatSkillDevelop,
  },
  {
    name: "author",
    description: "Guide for building and publishing workflow bundles",
    format: formatSkillAuthor,
  },
];

export function getSkillTopics(): ReadonlyArray<{ name: string; description: string }> {
  return SKILL_TOPICS.map((t) => ({ name: t.name, description: t.description }));
}

export function formatSkillTopic(topic: string): string | null {
  const entry = SKILL_TOPICS.find((t) => t.name === topic);
  if (entry === undefined) {
    return null;
  }
  return entry.format();
}

export function formatSkillIndex(): string {
  const rows = SKILL_TOPICS.map((t) => `| \`${t.name}\` | ${t.description} |`);
  return `# uncaged-workflow help --skill

Available topics:

| Topic | Description |
|-------|-------------|
${rows.join("\n")}

Usage: \`uncaged-workflow help --skill <topic>\`
`;
}

// ── cli topic (existing full reference) ────────────────────────────────

function formatSkillCli(): string {
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

// ── develop topic (for agents inside a workflow) ───────────────────────

function formatSkillDevelop(): string {
  return `# Workflow Role Guide

Reference for agents executing roles (planner, coder, reviewer, etc.) inside a running workflow thread.

## Thread ID

Every thread has a 26-character Crockford Base32 ULID (e.g. \`06F03H5V6JTMDST6P3TVH42RWM\`).

It appears in the **first message** of the conversation. If unsure:

\`\`\`
uncaged-workflow thread list
\`\`\`

## CAS (Content-Addressable Storage)

Store and retrieve content by hash, scoped to the current thread.

| Operation | Command |
|-----------|---------|
| **Store** | \`uncaged-workflow cas put <THREAD_ID> '<content>'\` → prints hash |
| **Read** | \`uncaged-workflow cas get <THREAD_ID> <HASH>\` → prints content |
| **List** | \`uncaged-workflow cas list <THREAD_ID>\` |

CAS is the **only** supported way to persist structured data (phase plans, review notes, etc.) within a thread. Do not use temp files.

## Meta Output

Each role must produce structured output that the moderator extracts. The exact schema depends on the role, but the pattern is:

1. Do your work (write code, run tests, etc.)
2. Output a compact JSON object matching the role's schema
3. The moderator extracts and validates it automatically

## Thread Context

The conversation history contains outputs from previous roles. Read it to understand:
- What task was requested (from the initial prompt)
- What previous roles produced (plans, code changes, review results)
- What the moderator decided (which phase to work on, whether to retry)
`;
}

// ── author topic (for workflow developers) ─────────────────────────────

function formatSkillAuthor(): string {
  return `# Workflow Authoring Guide

How to build, test, and publish workflow bundles for uncaged-workflow.

## Bundle Structure

A workflow bundle is a single ESM file (\`.esm.js\`) that exports:

\`\`\`typescript
// Required exports
export const descriptor: WorkflowDescriptor;
export const run: WorkflowRun;
\`\`\`

## WorkflowDescriptor

Defines the workflow's metadata and role sequence:

\`\`\`typescript
type WorkflowDescriptor = {
  name: string;           // verb-first kebab-case, e.g. "solve-issue"
  description: string;    // one-line summary
  roles: string[];        // ordered role names, e.g. ["planner", "coder", "reviewer"]
};
\`\`\`

## WorkflowRun

The main function that creates and returns a moderator:

\`\`\`typescript
type WorkflowRun = (ctx: WorkflowContext) => Moderator;
\`\`\`

The **Moderator** controls the flow — it decides which role runs next, handles retries, and determines when the workflow is complete.

## Role Definition

Each role has:

| Field | Type | Purpose |
|-------|------|---------|
| \`description\` | string | What the role does |
| \`systemPrompt\` | string | System prompt for the agent |
| \`extractPrompt\` | string | Instruction for extracting structured meta |
| \`schema\` | ZodSchema | Validates the extracted meta |
| \`extractRefs\` | fn or null | Extracts CAS hashes from meta for DAG linking |
| \`extractMode\` | "single" | Extraction mode |

## Development Workflow

\`\`\`bash
# 1. Initialize a workspace
uncaged-workflow init workspace my-workflow

# 2. Write your template (roles + moderator + descriptor)

# 3. Build the ESM bundle
bun run build

# 4. Register locally
uncaged-workflow workflow add my-workflow ./dist/my-workflow.esm.js

# 5. Test
uncaged-workflow run my-workflow --prompt "test task"
uncaged-workflow live --latest
\`\`\`

## Versioning

Bundles are immutable and identified by XXH64 hash. Re-registering a workflow with a new bundle creates a new version. Use \`workflow history\` and \`workflow rollback\` to manage versions.
`;
}

// ── Legacy compat ──────────────────────────────────────────────────────

/** @deprecated Use formatSkillTopic("cli") instead */
export function formatSkillDoc(): string {
  return formatSkillCli();
}
