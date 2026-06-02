export function generateAdapterReference(): string {
  return `# Adapter Reference

Guide for building a new agent adapter (CLI binary) for the workflow engine.

## What Is an Adapter

An adapter is a CLI command (e.g. \`uwf-hermes\`, \`uwf-builtin\`) that the engine spawns to execute a role. It bridges the workflow engine and an LLM/agent backend. The engine calls it with:

\`\`\`
uwf-<name> --thread <id> --role <role> --prompt <text>
\`\`\`

The adapter must produce frontmatter markdown output. The engine handles argument parsing, context building, output extraction, and CAS persistence — you just implement the LLM interaction.

## Quick Start

\`\`\`typescript
import { createAgent } from "@united-workforce/util-agent";
import type { AgentContext, AgentRunResult, AgentContinueFn, AgentRunFn } from "@united-workforce/util-agent";

const run: AgentRunFn = async (ctx: AgentContext): Promise<AgentRunResult> => {
  // 1. Build your prompt from ctx
  // 2. Call your LLM backend
  // 3. Return the result
  return { output: rawMarkdown, detailHash, sessionId };
};

const continue_: AgentContinueFn = async (sessionId, message, store) => {
  // Resume an existing session with a correction message
  return { output: correctedMarkdown, detailHash, sessionId };
};

const main = createAgent({ name: "my-agent", run, continue: continue_ });
main();
\`\`\`

## The \`createAgent\` Factory

\`createAgent(options)\` returns an async \`main()\` function that handles the full lifecycle:

1. Parses CLI args (\`--thread\`, \`--role\`, \`--prompt\`)
2. Loads \`.env\` from storage root
3. Builds \`AgentContext\` (thread history, workflow definition, role prompt)
4. Injects \`outputFormatInstruction\` from the role's frontmatter schema
5. Calls your \`run(ctx)\` function
6. Extracts frontmatter from your output via \`tryFrontmatterFastPath()\`
7. If extraction fails, calls your \`continue(sessionId, correctionMessage, store)\` up to 2 times
8. Persists the validated output as a CAS step node
9. Prints the step hash to stdout

You only implement \`run\` and \`continue\`.

## AgentOptions

\`\`\`typescript
type AgentOptions = {
  name: string;           // Adapter name (used in step records as "uwf-<name>")
  run: AgentRunFn;        // Execute a role from scratch
  continue: AgentContinueFn;  // Resume a session for frontmatter correction
};
\`\`\`

## AgentContext

The \`ctx\` object passed to your \`run\` function:

| Field | Type | Description |
|-------|------|-------------|
| \`threadId\` | \`string\` | Thread ULID |
| \`role\` | \`string\` | Role name being executed |
| \`edgePrompt\` | \`string\` | Moderator's task instruction for this step |
| \`workflow\` | \`WorkflowPayload\` | Full workflow definition (roles, graph) |
| \`start\` | \`StartNodePayload\` | Thread start data (workflow hash, user prompt) |
| \`steps\` | \`StepContext[]\` | Previous steps with expanded outputs |
| \`store\` | \`Store\` | CAS store for reading/writing data |
| \`outputFormatInstruction\` | \`string\` | Frontmatter format instruction (inject into system prompt) |
| \`isFirstVisit\` | \`boolean\` | True if this role hasn't run before in this thread |

## AgentRunResult

Your \`run\` and \`continue\` functions must return:

\`\`\`typescript
type AgentRunResult = {
  output: string;       // Raw markdown with frontmatter (must start with ---)
  detailHash: string;   // CAS hash of session detail (turn history, metadata)
  sessionId: string;    // Session ID for potential continue() calls
};
\`\`\`

## Building the Prompt

Use helpers from \`@united-workforce/util-agent\`:

| Helper | Purpose |
|--------|---------|
| \`buildRolePrompt(roleDef)\` | Assemble Goal/Capabilities/Prepare/Procedure/Output sections |
| \`buildContinuationPrompt(steps, role, edgePrompt)\` | For re-entry: steps since last visit + edge prompt |
| \`ctx.outputFormatInstruction\` | Pre-built frontmatter format block (inject into system prompt) |

Typical system prompt structure:
\`\`\`
[outputFormatInstruction]
[rolePrompt from buildRolePrompt()]
[workflow metadata]
\`\`\`

## Storing Session Detail

Store your turn history as a CAS merkle DAG for debugging and replay:

\`\`\`typescript
// Store each turn as a CAS text node
const turnHash = await store.put(textSchema, { content: turnData });

// Build a detail node referencing all turns
const detailHash = await store.put(detailSchema, { turns: turnHashes });
\`\`\`

The \`detailHash\` is preserved from the first \`run()\` call — retry \`continue()\` calls don't overwrite it.

## Registration

Register your adapter in \`~/.uncaged/workflow/config.yaml\`:

\`\`\`yaml
agents:
  my-agent:
    command: uwf-my-agent
    args: []
\`\`\`

Use it:
\`\`\`bash
uwf thread exec <thread-id> --agent my-agent
\`\`\`

Or set as default:
\`\`\`yaml
defaultAgent: my-agent
\`\`\`

## Existing Adapters

| Adapter | Package | Backend |
|---------|---------|---------|
| \`uwf-hermes\` | \`@united-workforce/agent-hermes\` | Hermes ACP (chat sessions) |
| \`uwf-builtin\` | \`@united-workforce/agent-builtin\` | Direct OpenAI API (tools + loop) |
| \`uwf-claude-code\` | \`@united-workforce/agent-claude-code\` | Claude Code CLI |

Study these for patterns on prompt building, session management, and detail storage.

## Checklist

1. Implement \`run(ctx)\` — build prompt, call LLM, return output + detailHash + sessionId
2. Implement \`continue(sessionId, message, store)\` — resume session for frontmatter correction
3. Store session detail as CAS nodes (for debugging)
4. Ensure output starts with \`---\` frontmatter block
5. Add a \`bin\` entry in \`package.json\` for the CLI command
6. Register in config.yaml and test with \`uwf thread exec --agent <name>\`
`;
}
