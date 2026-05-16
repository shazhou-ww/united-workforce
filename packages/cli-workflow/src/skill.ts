import { getCommandRegistry } from "./cli-registry.js";

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
  return `# uncaged-workflow skill

Available topics:

| Topic | Description |
|-------|-------------|
${rows.join("\n")}

Usage: \`uncaged-workflow skill <topic>\`
`;
}

// ── cli topic (existing full reference) ────────────────────────────────

function formatSkillCli(): string {
  const groups = getCommandRegistry();

  const commandSections: string[] = [];
  for (const group of groups) {
    const rows = group.commands.map((cmd) => {
      const namePart = cmd.name === "" ? "" : ` ${cmd.name}`;
      const args = cmd.args ? `\`${cmd.args}\`` : "(none)";
      return `| \`${group.name}${namePart}\` | ${args} | ${cmd.description} |`;
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
| **Thread** | A single execution of a workflow, identified by a ULID. CAS state chain; \`threads.json\` for active; \`history/*.jsonl\` when done; \`.info.jsonl\` for debug logs. |
| **CAS** | Global content-addressable blob store (\`cas/\`), keyed by hash. |
| **Registry** | \`workflow.yaml\` — maps workflow names to their current and historical bundle hashes. |

## Commands

${commandSections.join("\n\n")}

### Top-level shortcuts

| Command | Equivalent | Description |
|---------|------------|-------------|
| \`run\` | \`thread run\` | Shortcut to start a thread |
| \`live\` | \`thread live\` | Shortcut to attach to a thread |

### connect

| Command | Args | Description |
|---------|------|-------------|
| \`connect\` | \`[--name NAME] [--gateway URL]\` | Connect to workflow gateway via WebSocket. \`--name\` registers with the gateway. |

## Typical Workflow

1. \`uncaged-workflow workflow add my-wf ./my-wf.esm.js\` — register a workflow
2. \`uncaged-workflow run my-wf --prompt "do the thing"\` — start a thread
3. \`uncaged-workflow live --latest\` — attach and watch output
4. \`uncaged-workflow thread show <thread-id>\` — inspect completed thread

## Thread Status

| Status | Meaning |
|--------|---------|
| \`running\` | Worker process is alive (\`.running\` marker + live PID) |
| \`active\` | In \`threads.json\` but not currently running (paused or waiting) |
| \`completed\` | Finished with \`returnCode === 0\` (has \`__end__\` frame in CAS) |
| \`failed\` | Finished with non-zero return code, or worker crashed (dead PID / no ctl) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error |

## Environment Variables

| Variable | Description |
|----------|-------------|
| \`WORKFLOW_STORAGE_ROOT\` | Override the default storage directory for all workflow data |
| \`UNCAGED_WORKFLOW_STORAGE_ROOT\` | Same as above (takes priority) |
| \`WORKFLOW_LLM_API_KEY\` | API key for LLM calls during workflow execution |
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

Store and retrieve content by hash in workflow storage (global CAS directory).

| Operation | Command |
|-----------|---------|
| **Store** | \`uncaged-workflow cas put '<content>'\` → prints hash |
| **Read** | \`uncaged-workflow cas get <HASH>\` → prints content |
| **List** | \`uncaged-workflow cas list\` |

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
// Required named exports (no default export)
export const descriptor: WorkflowDescriptor;
export const run: WorkflowFn;
\`\`\`

## WorkflowDescriptor

Serialized metadata for the registry. Every role must include both \`description\` and \`schema\` (JSON Schema object). The graph uses an edges array where each edge has \`from\`, \`to\`, and \`condition\`.

\`\`\`typescript
type WorkflowDescriptor = {
  description: string;
  roles: Record<string, {
    description: string;
    schema: object;  // JSON Schema — use z.toJSONSchema(zodSchema) to generate
  }>;
  graph: {
    edges: Array<{
      from: string;       // role name, or "__start__"
      to: string;         // role name, or "__end__"
      condition: string;  // e.g. "FALLBACK"
      conditionDescription?: string | null;
    }>;
  };
};
\`\`\`

**descriptor is static data** — it is read at \`workflow add\` (register) time via \`import()\`. It must NOT trigger any side effects or read environment variables.

## WorkflowFn

Async generator from \`createWorkflow(definition, binding)\` (**@uncaged/workflow-runtime**) — yields each role output until the workflow completes.

## ModeratorTable

Declarative routing table. Transitions use the \`role\` field (not \`next\`):

\`\`\`typescript
import { START, END, type ModeratorTable } from "@uncaged/workflow-runtime";

const table: ModeratorTable<MyMeta> = {
  [START]: [{ condition: "FALLBACK", role: "firstRole" }],
  firstRole: [{ condition: "FALLBACK", role: END }],
};
\`\`\`

## AdapterFn / AdapterBinding

The adapter receives a system prompt and Zod schema, returns a \`RoleFn<T>\` that produces typed meta:

\`\`\`typescript
type AdapterFn = <T>(prompt: string, schema: ZodType<T>) => RoleFn<T>;
type AdapterBinding = {
  adapter: AdapterFn;
  overrides: Partial<Record<string, AdapterFn>> | null;
};
\`\`\`

## Role Definition

Each role has:

| Field | Type | Purpose |
|-------|------|---------|
| \`description\` | string | What the role does |
| \`systemPrompt\` | string | System prompt for the agent |
| \`schema\` | ZodSchema | Validates the extracted meta |
| \`extractRefs\` | fn or null | Extracts CAS hashes from meta for DAG linking |

## Development Workflow

\`\`\`bash
# 1. Initialize a workspace
uncaged-workflow init workspace my-workflow

# 2. Write your template (roles + ModeratorTable + definition)
# 3. Write entry file (workflows/*-entry.ts) with adapter binding + descriptor

# 4. Build the ESM bundle
bun run bundle   # uses scripts/bundle.ts

# 5. Register locally
uncaged-workflow workflow add my-workflow ./dist/my-workflow-entry.esm.js

# 6. Test
uncaged-workflow run my-workflow --prompt "test task"
uncaged-workflow live --latest
\`\`\`

## Versioning

Bundles are immutable and identified by XXH64 hash. Re-registering a workflow with a new bundle creates a new version. Use \`workflow history\` and \`workflow rollback\` to manage versions.

## Pitfalls

### Lazy initialization is mandatory

The bundle is \`import()\`-ed at register time (\`workflow add\`) to read the descriptor. At that point, no runtime env vars (API keys, etc.) are available.

**Never read env at module top-level.** Wrap provider/adapter creation in a lazy closure:

\`\`\`typescript
// ❌ WRONG — breaks register
const provider = { apiKey: process.env.MY_KEY! };
const adapter = createAdapter(provider);

// ✅ CORRECT — only reads env when run() is called
function createLazyAdapter(): AdapterFn {
  let cached: Provider | null = null;
  return (prompt, schema) => {
    return async (ctx, runtime) => {
      if (!cached) cached = { apiKey: process.env.MY_KEY! };
      // ... use cached provider
    };
  };
}
\`\`\`

### Agent CLI paths: use env() with absolute path defaults

Every env var in a bundle must have a sensible default — bundles must run without any env vars set. Use \`env(name, fallback)\` from \`@uncaged/workflow-util\`.

Discover the correct CLI path yourself (e.g. \`which cursor-agent\`, \`which hermes\`) and hardcode it as the fallback:

\`\`\`typescript
import { env } from "@uncaged/workflow-util";

// ❌ WRONG — requireEnv and optionalEnv no longer exist
const adapter = createCursorAgent({
  command: requireEnv("WORKFLOW_CURSOR_COMMAND", "set it"),
  ...
});

// ✅ CORRECT — env var is an override, fallback is the discovered absolute path
const adapter = createCursorAgent({
  command: env("WORKFLOW_CURSOR_COMMAND", "/home/you/.local/bin/cursor-agent"),
  model: env("WORKFLOW_CURSOR_MODEL", "auto"),
  timeout: Number(env("WORKFLOW_CURSOR_TIMEOUT", "300000")),
  ...
});
\`\`\`

### Bundle import restrictions

The bundle validator only allows these import specifiers:
- Node built-ins (\`node:fs\`, \`node:path\`, etc.)

All other dependencies — including \`@uncaged/workflow-*\` packages, zod, and any third-party code — must be bundled into the \`.esm.js\` file. Bundles are fully self-contained: same Node/Bun version = same behavior.

### No default exports

The engine only reads named exports \`run\` and \`descriptor\`. Using \`export default\` will cause registration to fail silently.

### Single-file ESM

The bundle must be a single \`.esm.js\` file. No dynamic \`import()\` inside the bundle — it breaks hash verification and the loader sandbox.
`;
}
