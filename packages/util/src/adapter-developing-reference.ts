import { VERSION } from "./version.js";

export function generateAdapterDevelopingReference(): string {
  return `---
name: uwf-adapter-developing
description: "Guide for building a new agent adapter (CLI binary) for the workflow engine."
version: ${VERSION}
tags: [uwf, adapter, agent, development]
---

# Adapter Developing Reference

Guide for building a new agent adapter (CLI binary) for the workflow engine.

## What Is an Adapter

An adapter is a CLI command (e.g. \`uwf-hermes\`, \`uwf-builtin\`, \`uwf-claude-code\`) that the engine spawns to execute a single role. It bridges the workflow engine and an LLM/agent backend. The engine calls it with:

\`\`\`
uwf-<name> --thread <id> --role <role> --prompt <text>
\`\`\`

The adapter must produce frontmatter markdown output. The engine handles argument parsing, context building, frontmatter extraction, retry, suspend interception, and CAS persistence — you implement only the LLM interaction.

The CLI propagates two environment variables to the adapter so it can locate storage:

- \`UWF_HOME\` — the uwf storage root (default \`~/.uwf\`). Used to resolve \`agents/<name>.yaml\` config and the per-agent session cache.
- \`OCAS_HOME\` — the global CAS directory (default \`~/.ocas\`). The store uses this to locate CAS nodes and variables.

The adapter receives both already resolved as \`ctx.storageRoot\` and \`ctx.casDir\` — never read \`process.env\` yourself.

## Quick Start

\`\`\`typescript
import { join } from "node:path";
import {
  buildContinuationPrompt,
  buildFrontmatterRetryPrompt,
  buildRolePrompt,
  buildSuspendOutput,
  buildThreadProgress,
  createAgent,
  getCachedSessionId,
  setCachedSessionId,
} from "@united-workforce/util-agent";
import type {
  AgentCleanupFn,
  AgentContext,
  AgentContinueFn,
  AgentForkFn,
  AgentRunFn,
  AgentRunResult,
} from "@united-workforce/util-agent";

const run: AgentRunFn = async (ctx: AgentContext): Promise<AgentRunResult> => {
  // Branch on isFirstVisit: build a fresh role prompt vs a re-entry continuation.
  const roleDef = ctx.workflow.roles[ctx.role];
  const systemPrompt = ctx.isFirstVisit
    ? \`\${ctx.outputFormatInstruction}\\n\\n\${buildRolePrompt(roleDef)}\`
    : buildContinuationPrompt(ctx.steps, ctx.role, ctx.edgePrompt);

  const userPrompt = \`\${buildThreadProgress(ctx.steps, ctx.role, ctx.threadId)}\\n\\n\${ctx.edgePrompt}\`;
  const assembledPrompt = \`\${systemPrompt}\\n\\n\${userPrompt}\`;

  // Reuse a cached LLM session per (thread, role) so the adapter doesn't
  // rebuild context on each step invocation.
  const cachedSession = await getCachedSessionId(
    "my-agent",
    ctx.threadId,
    ctx.role,
    ctx.storageRoot,
  );
  const { output, sessionId, detailHash, usage } = await callMyLlm({ // (your implementation)
    sessionId: cachedSession,
    systemPrompt,
    userPrompt,
    storageRoot: ctx.storageRoot,
    store: ctx.store,
  });

  if (cachedSession === null) {
    await setCachedSessionId("my-agent", ctx.threadId, ctx.role, sessionId, ctx.storageRoot);
  }

  // If the LLM signals a need for human input, yield via $SUSPEND.
  if (needsHumanInput(output)) { // (your implementation)
    return {
      output: buildSuspendOutput("Awaiting human approval"),
      detailHash,
      sessionId,
      assembledPrompt,
      usage,
    };
  }

  return { output, detailHash, sessionId, assembledPrompt, usage };
};

const continue_: AgentContinueFn = async (sessionId, message, store) => {
  // Resume an existing session for frontmatter correction. Use
  // buildFrontmatterRetryPrompt() to remind the agent that the work itself
  // succeeded — only the YAML envelope needs fixing.
  const retryPrompt = buildFrontmatterRetryPrompt(message);
  const { output, detailHash, usage } = await resumeMyLlm({ sessionId, retryPrompt, store }); // (your implementation)
  return { output, detailHash, sessionId, assembledPrompt: retryPrompt, usage };
};

const fork: AgentForkFn = async (sessionId, _store) => {
  // Branch the LLM session and return the new session id. Used by step ask.
  return await forkMyLlmSession(sessionId); // (your implementation)
};

const cleanup: AgentCleanupFn = async () => {
  // Release any I/O handles, kill subprocesses, close ACP clients.
  await closeMyLlmClient(); // (your implementation)
};

const main = createAgent({ name: "my-agent", run, continue: continue_, fork, cleanup });
main();
\`\`\`

## The \`createAgent\` Factory

\`createAgent(options)\` returns an async \`main()\` function that handles the full lifecycle:

1. Parses CLI args (\`--thread\`, \`--role\`, \`--prompt\`)
2. Resolves \`UWF_HOME\` and \`OCAS_HOME\` and loads \`.env\` from the storage root
3. Builds \`AgentContext\` (thread history, workflow definition, role prompt, isFirstVisit)
4. Injects \`outputFormatInstruction\` from the role's frontmatter schema
5. Calls your \`run(ctx)\` function
6. Attempts frontmatter extraction (parsing the leading \`---\` block) on the agent output
7. If extraction fails, calls your \`continue(sessionId, correctionMessage, store)\` up to 2 retries
8. Persists the validated output as a CAS step node
9. Writes a JSON \`AdapterOutput\` envelope to stdout
10. Invokes \`cleanup()\` — always, regardless of success or failure

You implement \`run\`, \`continue\`, optionally \`fork\`, optionally \`cleanup\`.

## AgentOptions

\`\`\`typescript
type AgentOptions = {
  name: string;                      // Adapter name (used in step records as "uwf-<name>")
  run: AgentRunFn;                   // Execute a role from scratch
  continue: AgentContinueFn;         // Resume a session for frontmatter correction
  fork: AgentForkFn | null;          // Branch a session for step ask; null = unsupported
  cleanup: AgentCleanupFn | null;    // Final teardown; null = nothing to release
};

type AgentForkFn = (sessionId: string, store: Store) => Promise<string>;
type AgentCleanupFn = () => Promise<void>;
\`\`\`

Notes on the optional hooks:

- **\`fork\`** branches an existing session and returns a new session id. Pass \`fork: null\` when the adapter does not implement step ask — the engine will surface a clear error if a user tries \`step ask\` against that adapter, instead of silently producing garbage.
- **\`cleanup\`** is invoked after the agent CLI completes (whether it succeeds or fails) so adapters can release resources deterministically — close ACP clients, kill subprocesses, free I/O handles.

## AgentContext

The \`ctx\` object passed to your \`run\` function:

| Field | Type | Description |
|-------|------|-------------|
| \`threadId\` | \`string\` | Thread ULID |
| \`role\` | \`string\` | Role name being executed |
| \`edgePrompt\` | \`string\` | Moderator's task instruction for this step (\`--prompt\` CLI arg) |
| \`workflow\` | \`WorkflowPayload\` | Full workflow definition (roles, graph) |
| \`start\` | \`StartNodePayload\` | Thread start data (workflow hash, user prompt, cwd) |
| \`steps\` | \`StepContext[]\` | Previous steps with expanded outputs |
| \`store\` | \`Store\` | CAS store for reading/writing data |
| \`outputFormatInstruction\` | \`string\` | Pre-built frontmatter format instruction (inject into system prompt) |
| \`isFirstVisit\` | \`boolean\` | True if this role has not appeared before in the thread's step history |
| \`storageRoot\` | \`string\` | Resolved \`UWF_HOME\` (e.g. \`~/.uwf\`); use to locate \`agents/<name>.yaml\` |
| \`casDir\` | \`string\` | Resolved \`OCAS_HOME\` (e.g. \`~/.ocas\`); the global CAS directory |

### \`isFirstVisit\` semantics

\`isFirstVisit\` is true when the role has not appeared in the thread's step history before this run. Branch on it:

- **First visit** — fresh start: build the full role prompt (Goal/Capabilities/Procedure/Output) so the agent knows what to do.
- **Re-entry** — resume after another role spoke: build a continuation prompt with the new \`steps\` since the last visit plus the current \`edgePrompt\`.

This keeps the assembled prompt short on re-entry and lets the LLM session reuse its cached context.

## AgentRunResult

Your \`run\`, \`continue\`, and any retry calls must return all 5 fields:

\`\`\`typescript
type AgentRunResult = {
  output: string;            // Raw markdown beginning with --- frontmatter
  detailHash: string;        // CAS hash of session detail (turn history, metadata)
  sessionId: string;         // Session id for continue() / fork() calls
  assembledPrompt: string;   // The fully assembled prompt that was sent to the agent
  usage: Usage | null;       // Token usage stats; null when the backend doesn't report
};

type Usage = {
  turns: number;             // Internal LLM turns (tool calls + final reply)
  inputTokens: number;       // Prompt tokens billed
  outputTokens: number;      // Completion tokens billed
  duration: number;          // Wall-clock seconds for this run
};
\`\`\`

The engine stores \`assembledPrompt\` as a CAS text node (visible via \`step read --prompt\`) and surfaces \`usage\` in \`step show\` and dashboards.

## Building the Prompt

Use these helpers from \`@united-workforce/util-agent\` to assemble the prompt and supporting state:

| Helper | Purpose |
|--------|---------|
| \`buildRolePrompt(roleDef)\` | Assemble Goal/Capabilities/Prepare/Procedure/Output sections from a \`RoleDefinition\` |
| \`buildContinuationPrompt(steps, role, edgePrompt)\` | Re-entry prompt: steps since last visit + current edge prompt |
| \`buildThreadProgress(steps, role, threadId?)\` | Thread ID + "Thread step N. You (role) have spoken K times." progress hint |
| \`buildOutputFormatInstruction(schema)\` | Convert a frontmatter JSON Schema into a deliverable-format instruction (engine pre-builds this into \`ctx.outputFormatInstruction\`) |
| \`buildSuspendOutput(reason)\` | Emit a \`$SUSPEND\` coroutine yield (see Coroutine Yield section) |
| \`buildFrontmatterRetryPrompt(formatInstruction)\` | Minimal prompt for \`continue()\` retries: "work is done, just fix the YAML" |
| \`getCachedSessionId(name, threadId, role, storageRoot)\` | Read the per-(thread, role) session cache so \`run()\` can resume |
| \`setCachedSessionId(name, threadId, role, sessionId, storageRoot)\` | Write the per-(thread, role) session cache after a fresh session is created |
| \`getAskSessionId(name, stepHash, storageRoot)\` | Read a forked side-conversation session keyed by step hash (used by \`step ask\`) |
| \`setAskSessionId(name, stepHash, sessionId, storageRoot)\` | Write a forked side-conversation session keyed by step hash |

A typical system prompt structure:

\`\`\`
[ctx.outputFormatInstruction]   (engine-injected)
[buildRolePrompt(roleDef)]      (or buildContinuationPrompt on re-entry)
[buildThreadProgress(...)]      (optional state hint)
[ctx.edgePrompt]                (the moderator's task for this step)
\`\`\`

## Frontmatter Extraction

The agent's \`output\` string must begin with a \`---\` delimited YAML block describing the role's deliverable. The engine attempts frontmatter extraction by parsing this leading block, validating it against the role's \`outputSchema\`, and storing the result as a CAS node.

The exported helper \`tryFrontmatterFastPath(raw, schema, store)\` performs that try-and-parse step. It returns \`null\` (the parse attempt failed gracefully) or a \`FrontmatterFastPathResult\` containing the stored hash, parsed fields, and stripped body. You normally do not call it yourself — the \`createAgent\` lifecycle does — but it is exported for adapters that want to inspect output before deciding how to retry.

If extraction fails, \`createAgent\` calls your \`continue()\` with \`buildFrontmatterRetryPrompt()\` and tries again. After 2 retries the engine gives up and persists a failed StepNode (see *Failed Steps & previousAttempts* below).

## Coroutine Yield: \`$SUSPEND\`

\`$SUSPEND\` is a reserved \`$status\` value that pauses the thread and waits for human input — a coroutine yield. Any role may emit it regardless of its declared output schema; the engine intercepts it before the moderator and marks the thread suspended.

The wire format is a frontmatter block with two fields:

\`\`\`markdown
---
$status: "$SUSPEND"
reason: "Human-readable explanation"
---
\`\`\`

Use \`buildSuspendOutput(reason)\` to construct this; do not hand-write it. The engine round-trips the parse via \`trySuspendFastPath()\`, which stores the output against the reserved \`SUSPEND_OUTPUT_SCHEMA\` (a.k.a. \`schemas.suspendOutput\`) instead of the role's own schema.

When a thread is suspended, \`uwf thread resume\` re-runs the same role with the original prompt plus any \`-p\` supplementary context.

## Supporting \`step ask\`

\`step ask\` lets a user pose a follow-up question to a completed step's agent without polluting the thread. The engine spawns the adapter with a different argv shape than \`run\`:

| Mode | Argv | Adapter must |
|------|------|--------------|
| Fork | \`--mode fork --session <source>\` | Branch the source session; print the new session id to stdout (last line) |
| Ask  | \`--mode ask --session <forked> --prompt <text> [--detail <ref>]\` | Run a one-shot reply against the forked session; stream the answer to stdout |

The CLI orchestrator calls fork once per step (caching the result under \`<stepHash>:ask\` via \`getAskSessionId\`/\`setAskSessionId\`) and then calls ask repeatedly for follow-up questions.

Adapters with \`fork: null\` are not required to handle \`--mode fork\` or \`--mode ask\`; the engine refuses \`step ask\` against them with a clear error.

## Failed Steps & \`previousAttempts\`

If frontmatter extraction fails after 2 frontmatter retries, the engine persists a failed StepNode whose \`output\` ref points to an \`ErrorOutputPayload\`:

\`\`\`typescript
type ErrorOutputPayload = {
  $status: "error";
  error: string;
  phase: string | null;   // e.g. "frontmatter_extraction"
};
\`\`\`

Important: **the thread head is NOT advanced** when \`isError\` is true. The failed StepNode is recorded in CAS so its turns and usage are preserved, but routing does not progress.

To bridge a failed attempt to a future successful retry, the engine stores the failed step hash in a per-(thread, role) variable:

\`\`\`
@uwf/thread-failed/<threadId>/<role>
\`\`\`

When the same role next succeeds, the engine reads this variable and writes the failed hashes into the new step's \`previousAttempts: CasRef[] | null\` field — \`previousAttempts\` lists CAS refs to prior failed StepNodes for that role. Tools like \`step show\` can then walk back through prior failed retry attempts.

You generally do not interact with this machinery from the adapter — emitting valid frontmatter (or \`$SUSPEND\`) is enough.

## AdapterOutput Stdout Contract

The adapter's stdout contract is a single JSON line of \`AdapterOutput\` (not a bare hash):

\`\`\`typescript
type AdapterOutput = {
  stepHash: string;           // CAS ref of the persisted StepNode
  detailHash: string;         // CAS ref of the session detail node
  role: string;               // Role name
  frontmatter: object;        // Parsed frontmatter fields
  body: string;               // Markdown body (after the --- block)
  startedAtMs: number;
  completedAtMs: number;
  usage: Usage | null;
  isError: boolean;           // true when the step persisted but failed
  errorMessage: string | null; // Human-readable message when isError
};
\`\`\`

The CLI parses this JSON from stdout to drive routing, advance head, and surface errors. \`createAgent\` writes it for you — just return correct \`AgentRunResult\`s.

## Adapter-Owned LLM Config

Engine config (\`~/.uwf/config.yaml\`) is LLM-free: it stores only \`agents\`, \`defaultAgent\`, and \`agentOverrides\`. There are no provider, model, or API key fields at the engine level.

Each adapter owns its own LLM configuration at:

\`\`\`
~/.uwf/agents/<name>.yaml
\`\`\`

Resolve the absolute path from \`ctx.storageRoot\` (e.g. \`join(ctx.storageRoot, "agents", "my-agent.yaml")\`) and read it inside \`run()\`. A typical schema:

\`\`\`yaml
provider:
  baseUrl: https://api.openai.com/v1
  apiKey: sk-...
model: gpt-4o-mini
\`\`\`

Failing to find the file should produce a clear error pointing the user at the path. The \`agent-builtin\` package ships \`loadBuiltinLlmConfig(storageRoot)\` as a reference implementation.

## Session Cache

The session cache lives at \`<storageRoot>/cache/<agentName>-sessions.json\` and uses two key shapes:

- **Exec sessions** — \`<threadId>:<role>\` — created by \`run()\` and reused on re-entry to skip context rebuilding. Use \`getCachedSessionId\`/\`setCachedSessionId\`.
- **Ask sessions** — \`<stepHash>:ask\` — created by \`fork()\` for \`step ask\` side conversations, keyed per source step so each forked session is isolated. Use \`getAskSessionId\`/\`setAskSessionId\`.

Atomic writes (write-tmp-then-rename) protect the cache from partial reads if you ever run agents in parallel.

## Storing Session Detail

Store your turn history as a CAS DAG so \`step read\`, \`step show\`, and dashboards can replay or inspect the run. Use \`registerAgentSchemas(store)\` once per process to register the standard schemas (returns hashes including \`schemas.text\` and \`schemas.stepNode\`), then write turns as CAS text nodes:

\`\`\`typescript
import { registerAgentSchemas } from "@united-workforce/util-agent";

const schemas = await registerAgentSchemas(ctx.store);

// Store each turn as a CAS text node
const turnHashes: string[] = [];
for (const turn of turns) {
  const turnHash = await ctx.store.cas.put(schemas.text, JSON.stringify(turn));
  turnHashes.push(turnHash);
}

// Build a detail node referencing all turns (use a schema you register
// for your adapter, or the existing builtin/claude-code helpers)
const detailHash = await ctx.store.cas.put(schemas.text, JSON.stringify({ turns: turnHashes }));
\`\`\`

For convenience, the builtin and claude-code adapters expose \`storeBuiltinDetail\` / \`storeClaudeCodeDetail\` helpers that wrap this pattern with their own detail schemas.

The \`detailHash\` from the first \`run()\` call is preserved across \`continue()\` retries — the engine never overwrites it.

## Registration

Register your adapter in \`~/.uwf/config.yaml\`:

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

Remember: the engine config has no LLM fields. Put provider/baseUrl/apiKey/model in \`~/.uwf/agents/my-agent.yaml\` instead.

## Existing Adapters

| Adapter | Package | Backend |
|---------|---------|---------|
| \`uwf-hermes\` | \`@united-workforce/agent-hermes\` | Hermes ACP (chat sessions) |
| \`uwf-builtin\` | \`@united-workforce/agent-builtin\` | Direct OpenAI-compatible API (tools + loop) |
| \`uwf-claude-code\` | \`@united-workforce/agent-claude-code\` | Claude Code CLI |

Study these for patterns on prompt building, session management, suspend handling, fork support, and detail storage.

## Checklist

1. Implement \`run(ctx)\` — branch on \`isFirstVisit\`, build the prompt from helpers, call your LLM, return all 5 \`AgentRunResult\` fields (\`output\`, \`detailHash\`, \`sessionId\`, \`assembledPrompt\`, \`usage\`)
2. Implement \`continue(sessionId, message, store)\` — resume a session and re-emit corrected frontmatter (use \`buildFrontmatterRetryPrompt\`)
3. Decide on \`fork\` — implement \`AgentForkFn\` to support \`step ask\`, or pass \`fork: null\`
4. Decide on \`cleanup\` — implement \`AgentCleanupFn\` for adapters that hold I/O resources, or pass \`cleanup: null\`
5. Yield with \`$SUSPEND\` when human input is needed — emit it via \`buildSuspendOutput(reason)\`
6. Persist session detail as CAS nodes via registered schemas (e.g. \`registerAgentSchemas\`)
7. Store the adapter's LLM config under \`~/.uwf/agents/<name>.yaml\` (provider/baseUrl/apiKey/model). Engine config is adapter-owned-LLM-free.
8. Use the session cache (\`getCachedSessionId\`/\`setCachedSessionId\` for exec, \`getAskSessionId\`/\`setAskSessionId\` for ask) to skip context rebuilding
9. Ensure output starts with a \`---\` frontmatter block matching the role's \`outputSchema\`
10. Add a \`bin\` entry in \`package.json\` for the CLI command
11. Register in \`config.yaml\` and test with \`uwf thread exec --agent <name>\`
`;
}
