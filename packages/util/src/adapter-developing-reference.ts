import { VERSION } from "./version.js";

export function generateAdapterDevelopingReference(): string {
  return `---
name: uwf-adapter-developing
description: "Guide for adding a new agent integration: Sumeru gateway (broker-routed) or in-process via createAgent."
version: ${VERSION}
tags: [uwf, adapter, agent, broker, development]
---

# Adapter Developing Reference

Guide for adding a new agent integration to the workflow engine.

## Two Integration Paths

After Phase 3 (\`@united-workforce/broker\`) and Phase 4 cleanup (#381), the
preferred way to plug a new LLM/agent backend into uwf is to expose it as a
**Sumeru gateway** that the broker contacts over HTTP. The legacy per-agent
CLI binaries that used to live under \`packages/agent-<name>\` have been
moved to \`legacy-packages/\` and are no longer published; their npm versions
have been deprecated in favor of \`@united-workforce/broker\`.

| Path | When to choose | Where it lives |
|------|----------------|----------------|
| **Sumeru gateway (preferred)** | The agent runs out-of-process, owns its own session lifecycle, and is reachable over HTTP (chat sessions, CLI subprocesses you wrap, hosted services). | Outside this repo — your gateway listens on \`http://host:port\` and implements the broker's send/resume/poke verbs. |
| **In-process \`createAgent\`** | The agent runs inside the \`uwf\` Node process — typically tools-bearing OpenAI-compatible loops or deterministic mocks for tests. | A workspace package (e.g. \`packages/agent-builtin\`, \`packages/agent-mock\`) that imports \`createAgent\` from \`@united-workforce/util-agent\`. |

The rest of this guide covers both paths.

## Path A: Sumeru Gateway via Broker

### Wire-level shape

The broker (\`@united-workforce/broker\`) calls your gateway's HTTP endpoints.
Each call carries a \`sessionId\`, a \`role\`, and the assembled prompt; your
gateway returns the agent's frontmatter markdown plus token usage.

\`\`\`yaml
# ~/.uwf/config.yaml
agents:
  my-agent:
    host: http://127.0.0.1:7900
    gateway: my-agent
defaultAgent: my-agent
\`\`\`

### What the gateway must do

1. Accept the broker's \`send\` / \`resume\` / \`poke\` HTTP calls.
2. Route to the right LLM backend (provider, model, API key — your gateway
   owns this entirely; engine config is LLM-free).
3. Persist its own session state so subsequent \`send\` calls within the same
   thread can reuse the LLM context.
4. Return frontmatter markdown that begins with a \`---\` block matching the
   role's \`outputSchema\`. The CLI runs broker's \`tryFrontmatterFastPath\`
   against your output and retries up to twice with
   \`buildFrontmatterRetryPrompt\` if the YAML is malformed.
5. Optionally yield with \`$status: "$SUSPEND"\` and a \`reason\` to pause the
   thread (rate limits, awaiting human input, token-budget exhaustion).

### What the broker handles for you

- **Session storage** — the broker tracks \`sessionId\` per (thread, role) in
  its own session-store; you don't need to mirror this on the engine side.
- **Frontmatter retry / suspend interception** — the CLI re-invokes the
  broker with \`buildFrontmatterRetryPrompt\` if extraction fails, and
  intercepts \`$SUSPEND\` before the moderator routes.
- **CAS persistence** — every step + assembled prompt + usage record lands
  as a CAS node automatically.
- **Routing & moderation** — pure status-graph evaluation in the CLI; your
  gateway never sees the workflow definition.

### Reading the broker source

Study \`packages/broker/src/\` for:

- \`broker.ts\` — \`createBroker(...)\`, \`broker.send()\`, \`broker.resume()\`,
  \`broker.poke()\`.
- \`session-store/\` — replaces the per-agent SQLite session caches that
  used to live in \`util-agent/session-cache.ts\` (now archived).
- \`packages/cli/src/commands/broker-step.ts\` — how the CLI orchestrates
  send → frontmatter extract → retry → persist.

## Path B: In-Process \`createAgent\` Adapters

When the agent runs inside the same Node process — for instance,
\`agent-builtin\` (an OpenAI-compatible tools loop) or \`agent-mock\` (scripted
fixtures for E2E tests) — implement it as a workspace package and use
\`createAgent\` from \`@united-workforce/util-agent\`.

\`\`\`typescript
import { type AgentContext, type AgentRunResult, createAgent } from "@united-workforce/util-agent";

const main = createAgent({
  name: "my-agent",
  run: async (ctx: AgentContext): Promise<AgentRunResult> => {
    // Build your prompt using ctx.role / ctx.workflow / ctx.steps / ctx.edgePrompt,
    // call your in-process backend, and return the agent's raw frontmatter markdown.
    return {
      output: "---\\n$status: done\\n---\\nbody",
      detailHash: "<cas-hash-of-detail-record>",
      sessionId: "session-id",
      assembledPrompt: "...",
      usage: null,
    };
  },
  continue: async (sessionId, message, store) => {
    // Resume the session for frontmatter correction. Receive an existing
    // sessionId and a correction message; return another AgentRunResult.
    return {
      output: "---\\n$status: done\\n---\\nbody",
      detailHash: "...",
      sessionId,
      assembledPrompt: message,
      usage: null,
    };
  },
  fork: null,
  cleanup: null,
});

main();
\`\`\`

The \`createAgent\` factory handles argv parsing, context building, frontmatter
extraction with retry, suspend interception, and CAS persistence — you
implement \`run\` and \`continue\`.

### \`AgentContext\`

The \`ctx\` object passed to your \`run\` function:

| Field | Type | Description |
|-------|------|-------------|
| \`threadId\` | \`string\` | Thread ULID |
| \`role\` | \`string\` | Role name being executed |
| \`edgePrompt\` | \`string\` | Moderator's task instruction for this step |
| \`workflow\` | \`WorkflowPayload\` | Full workflow definition |
| \`steps\` | \`StepContext[]\` | Previous steps with expanded outputs |
| \`store\` | \`Store\` | CAS store for reading/writing data |
| \`outputFormatInstruction\` | \`string\` | Pre-built frontmatter format instruction |
| \`isFirstVisit\` | \`boolean\` | True if this role has not appeared before in the thread's step history |
| \`storageRoot\` | \`string\` | Resolved \`UWF_HOME\` (e.g. \`~/.uwf\`) |
| \`casDir\` | \`string\` | Resolved \`OCAS_HOME\` (e.g. \`~/.ocas\`) |

### \`AgentRunResult\`

\`\`\`typescript
type AgentRunResult = {
  output: string;            // Raw markdown beginning with --- frontmatter
  detailHash: string;        // CAS hash of session detail (turn history, metadata)
  sessionId: string;         // Session id for continue() calls
  assembledPrompt: string;   // The fully assembled prompt sent to the agent
  usage: Usage | null;       // Token usage stats; null when the backend doesn't report
};

type Usage = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  duration: number;
};
\`\`\`

The engine stores \`assembledPrompt\` as a CAS text node (visible via
\`step read --prompt\`) and surfaces \`usage\` in \`step show\` and dashboards.

### Public helpers from \`@united-workforce/util-agent\`

After Phase 4 cleanup, the public API is intentionally narrow — only the
helpers consumed by \`cli\`, \`broker\`, \`agent-builtin\`, and \`agent-mock\`
remain exported:

| Helper | Purpose |
|--------|---------|
| \`createAgent(options)\` | Factory that wraps your \`run\` / \`continue\` into a CLI lifecycle |
| \`buildRolePrompt(roleDef)\` | Assemble Goal/Capabilities/Prepare/Procedure/Output sections |
| \`buildOutputFormatInstruction(schema)\` | Convert a frontmatter JSON Schema into a deliverable-format instruction |
| \`buildFrontmatterRetryPrompt(formatInstruction)\` | Minimal prompt for \`continue()\` retries |
| \`tryFrontmatterFastPath(raw, schema, store)\` | Try-and-parse frontmatter against a role schema |
| \`trySuspendFastPath(raw, schema, store)\` | Try-and-parse a \`$SUSPEND\` coroutine yield |
| \`mergeUsage(a, b)\` | Sum two \`Usage\` records across a primary run + retries |
| \`registerAgentSchemas(store)\` | Register text / step-node / suspend-output schemas in CAS |
| \`getEnvPath\` / \`getConfigPath\` / \`resolveStorageRoot\` / \`loadWorkflowConfig\` | Storage-root path helpers (used by the CLI when wiring contexts) |

The legacy adapter-only helpers (the per-agent SQLite session cache,
external-CLI continuation prompt builder, thread-progress hint, \`buildContext\`,
\`buildSuspendOutput\`, the argv parser, and the fork/cleanup adapter type
aliases) live in the archived \`legacy-packages/\` adapters and are no longer
part of the public surface — broker-hosted agents do not need them.

### Frontmatter extraction

The agent's \`output\` string must begin with a \`---\` delimited YAML block
describing the role's deliverable. The engine attempts frontmatter extraction
by parsing this leading block, validating it against the role's
\`outputSchema\`, and storing the result as a CAS node. \`createAgent\` calls
\`tryFrontmatterFastPath\` on your output; if extraction fails it calls your
\`continue()\` with \`buildFrontmatterRetryPrompt()\` and tries again. After
two retries the engine gives up and persists a failed StepNode (see
*Failed Steps & previousAttempts* below).

### Adapter-owned LLM config

Engine config (\`~/.uwf/config.yaml\`) is LLM-free: it only stores \`agents\`,
\`defaultAgent\`, and \`agentOverrides\`. Each in-process adapter owns its own
LLM config under \`~/.uwf/agents/<name>.yaml\` — see
\`packages/agent-builtin/src/llm/config.ts\` for the reference
implementation that loads \`provider\`, \`baseUrl\`, \`apiKey\`, and \`model\`.
Resolve the absolute path from \`ctx.storageRoot\`.

### \`$SUSPEND\` coroutine yield

Any role may yield by emitting:

\`\`\`markdown
---
$status: "$SUSPEND"
reason: "Awaiting human approval"
---
\`\`\`

The engine intercepts this before the moderator and marks the thread
\`suspended\`; \`uwf thread resume\` re-runs the same role with the original
prompt plus optional \`-p\` supplementary context. Adapters typically emit
\`$SUSPEND\` when they hit token budgets, rate limits, or detect missing
information.

### Failed steps & \`previousAttempts\`

If frontmatter extraction fails after two retries, the engine persists a
failed StepNode whose \`output\` ref points to an \`ErrorOutputPayload\`:

\`\`\`typescript
type ErrorOutputPayload = {
  $status: "error";
  error: string;
  phase: string | null;   // e.g. "frontmatter_extraction"
};
\`\`\`

Important: **the thread head is NOT advanced** when \`isError\` is true.
The failed StepNode is recorded in CAS so its turns and usage are preserved,
but routing does not progress.

To bridge a failed attempt to a future successful retry, the engine stores
the failed step hash in a per-(thread, role) variable
(\`@uwf/thread-failed/<threadId>/<role>\`). When the same role next succeeds,
the engine reads this variable and writes the failed hashes into the new
step's \`previousAttempts: CasRef[] | null\` field. Tools like \`step show\`
can then walk back through prior failed retry attempts.

You generally do not interact with this machinery from the adapter —
emitting valid frontmatter (or \`$SUSPEND\`) is enough.

### Session detail

Store your turn history as a CAS DAG so \`step read\`, \`step show\`, and
dashboards can replay or inspect the run. Use \`registerAgentSchemas(store)\`
once per process to register the standard schemas (returns hashes including
\`schemas.text\` and \`schemas.stepNode\`), then write each turn as a CAS text
node and reference them from a detail node:

\`\`\`typescript
import { registerAgentSchemas } from "@united-workforce/util-agent";

const schemas = await registerAgentSchemas(ctx.store);

const turnHashes: string[] = [];
for (const turn of turns) {
  const turnHash = await ctx.store.cas.put(schemas.text, JSON.stringify(turn));
  turnHashes.push(turnHash);
}

const detailHash = await ctx.store.cas.put(
  schemas.text,
  JSON.stringify({ turns: turnHashes }),
);
\`\`\`

The \`detailHash\` from the first \`run()\` call is preserved across
\`continue()\` retries — the engine never overwrites it.

### Existing in-process adapters

| Adapter | Package | Backend |
|---------|---------|---------|
| \`uwf-builtin\` | \`@united-workforce/agent-builtin\` | Direct OpenAI-compatible API + tools loop |
| \`uwf-mock\` | \`@united-workforce/agent-mock\` | Scripted fixtures for E2E tests |

## Recap: which path do I want?

- **Hosted LLM service / external CLI / network-accessible agent** → write a
  Sumeru gateway and register it under \`agents\` in \`~/.uwf/config.yaml\`.
- **In-process tools loop / deterministic test fixture** → ship a workspace
  package that calls \`createAgent\` and add a \`bin\` entry pointing at its
  \`dist/cli.js\`.

In either case the engine config stays LLM-free and you do NOT need to
publish a \`@united-workforce/agent-<name>\` package — the legacy per-agent
CLI binaries are preserved under \`legacy-packages/\` for historical
reference only.

## Checklist

1. Decide on integration path: gateway (broker) vs in-process (\`createAgent\`).
2. **Gateway path** — implement send/resume/poke HTTP endpoints; manage your
   own session state; return frontmatter markdown.
3. **In-process path** — implement \`run(ctx)\` and \`continue(sessionId, message, store)\`;
   pass \`fork: null\` and \`cleanup: null\` unless you need them.
4. Yield with \`$SUSPEND\` (\`---\\n$status: "$SUSPEND"\\nreason: ...\\n---\`)
   when human input is needed.
5. Store the adapter's LLM config under \`~/.uwf/agents/<name>.yaml\`. Engine
   config remains LLM-free.
6. Ensure output starts with a \`---\` frontmatter block matching the role's
   \`outputSchema\`.
7. Register your agent under \`agents\` in \`~/.uwf/config.yaml\` and test with
   \`uwf thread exec --agent <name>\`.
`;
}
