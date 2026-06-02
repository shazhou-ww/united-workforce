export function generateDeveloperReference(): string {
  return `# Developer Reference

Guide for contributing to the workflow engine codebase.

## Monorepo Structure

\`\`\`
packages/
  workflow-protocol/      # Shared types (WorkflowPayload, StepNodePayload, etc.)
  workflow-util/          # Base32, ULID, logger, frontmatter parsing, skill references
  workflow-util-agent/    # createAgent factory, context builder, extract pipeline
  workflow-agent-hermes/  # uwf-hermes CLI (spawns Hermes chat sessions)
  workflow-agent-builtin/ # uwf-builtin CLI (direct LLM calls via OpenAI API)
  cli-workflow/           # uwf CLI (moderator, thread/step/cas/config commands)
\`\`\`

Dependency layers (each only imports from packages above it):
\`\`\`
protocol → util → util-agent → agent-hermes / agent-builtin / cli-workflow
\`\`\`

External CAS: \`@ocas/core\` (store API, hashing, schema validation) + \`@ocas/fs\` (filesystem backend).

## Coding Conventions

### Functional-first

| Rule | Description |
|------|-------------|
| \`type\` over \`interface\` | All type definitions use \`type\` |
| \`function\` over \`class\` | Pure functions + closures, no class |
| No \`this\` | Functions must not depend on \`this\` context |
| No inheritance | No \`extends\`, \`implements\`, \`abstract\` |
| No optional properties | Use \`T \\| null\` instead of \`?:\` |
| Immutability first | Use \`Readonly<T>\`, \`as const\`, avoid mutation |

Classes allowed only when required by third-party libraries or for Error subclasses.

### Error Handling

- \`Result<T, E>\` type for expected failures (\`ok\`/\`err\` constructors from \`@united-workforce/util\`)
- \`throw\` only for unrecoverable bugs
- No try-catch for flow control

### Async

Always \`async/await\`, never \`.then()\` chains.

### Logging

\`console.*\` is banned (Biome \`noConsole\` rule). Use the structured logger:

\`\`\`typescript
import { createLogger } from "@united-workforce/util";
const log = createLogger();
log("4KNMR2PX", "Loading workflow...");  // 8-char Crockford Base32 tag
\`\`\`

Each call site gets a unique hand-written tag. \`grep "4KNMR2PX"\` in logs → instant code location.

CLI package (\`@united-workforce/cli\`) may use \`console.log\` for user-facing output with a biome-ignore comment.

### No Dynamic Import

No \`await import()\` in production code. Always static top-level \`import\`. Test files are exempt.

### Naming

- Workflow names: verb-first kebab-case (\`solve-issue\`, \`review-code\`)
- IDs: Crockford Base32 — CAS hash (XXH64, 13-char), Thread ID (ULID, 26-char)

## Development Workflow

\`\`\`bash
bun install                 # install all workspace deps
bun run build               # tsc --build (all packages)
bun run check               # tsc + biome check + lint-log-tags
bun run format              # biome format --write
bun test                    # run all tests
\`\`\`

Before committing: \`bun run check\` + \`bun test\` must both pass.

### Testing

- \`cli-workflow\`: vitest
- Other packages: \`bun test\`
- Test files live in \`__tests__/\` directories

### Publishing

Fixed-mode versioning — all \`@united-workforce/*\` packages share the same version number.

\`\`\`bash
bun changeset               # describe the change
bun version                 # bump versions + changelogs
bun release                 # build + test + publish to npmjs
\`\`\`

## Key Modules

### Moderator (\`cli-workflow/src/moderator/\`)

Status-based graph evaluator. Reads \`graph[lastRole][output.$status]\` to determine the next role. Zero LLM cost.

### Extract Pipeline (\`workflow-util-agent/src/\`)

1. Agent produces frontmatter markdown
2. \`parseFrontmatterMarkdown()\` extracts YAML frontmatter
3. \`tryFrontmatterFastPath()\` validates against role's output schema
4. If fast path fails, retries up to 2 times via agent continue
5. Validated output stored as CAS node

### createAgent Factory (\`workflow-util-agent/src/run.ts\`)

Shared entry point for all agent CLIs. Handles:
- Argument parsing (\`--thread\`, \`--role\`, \`--prompt\`)
- Context building (thread history, workflow definition)
- Output extraction and CAS persistence
- Frontmatter retry loop

### CAS Integration

All data is CAS-addressed via \`@ocas/core\`:
- \`store.put(schemaHash, data)\` → content hash
- \`store.get(hash)\` → node
- \`validate(store, node)\` → schema check
- Schemas registered at workflow add time

## Commit Convention

\`\`\`
<type>(<scope>): <description>

type: feat | fix | refactor | docs | chore | test
scope: workflow | cli | moderator | util-agent | hermes | util | protocol
\`\`\`
`;
}
