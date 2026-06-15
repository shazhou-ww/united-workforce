---
scenario: "uwf thread exec replaces the spawnAgent CLI binary path with broker.send() over Sumeru"
feature: thread
tags: [cli, thread-exec, broker, integration, mvp]
---

## Given
- A workflow has been registered and a thread has been started: `uwf thread start solve-issue -p "..."` produced thread id `06FCJ...`
- `~/.uwf/config.yaml` declares the new agent shape, e.g.
  ```yaml
  defaultAgent: claude-code
  agents:
    claude-code:
      host: http://127.0.0.1:7900
      gateway: claude-code
  ```
- A Sumeru host at `http://127.0.0.1:7900` is reachable and exposes the `claude-code` gateway
- The broker session store at `<storageRoot>/broker/sessions.db` exists (or is auto-created by `createSessionStore`)

## When
- The user runs `uwf thread exec 06FCJ...` (no `--agent` flag)

## Then
- `cmdThreadStepOnce()` in `packages/cli/src/commands/thread.ts` does NOT call `spawnAgent()` / `executeAgentCommand()` / `execFileSync()` — those code paths are unreachable for `thread exec`
- `cmdThreadStepOnce()` instead instantiates a broker (`createBroker` from `@united-workforce/broker`) wired with:
  - the shared session store opened from the same storage root
  - a `resolveRoute(role)` callback that returns `{ host, gateway, cwd }` derived from `resolveAgentConfig(config, workflow, role, agentOverride)`, where `cwd` is the thread's `chain.start.cwd`
- The CLI calls `broker.send({ threadId, role, prompt: edgePrompt })` once for the resolved role and awaits the result
- `broker.send()` consults `sessionStore.getSession(threadId, role)`:
  - **Cache miss**: creates a Sumeru session (`POST /gateways/claude-code/sessions` with `{"workspaceRoot": <cwd>}`), upserts the mapping BEFORE sending, then sends the prompt
  - **Cache hit**: posts directly to `POST /gateways/claude-code/sessions/<sessionId>/messages`
- The CLI takes the broker's `result.output` (raw last-assistant-turn content) and feeds it through frontmatter extraction (see `cli-frontmatter-extraction-after-broker.md`) to obtain a `StepNode` CAS hash
- The CLI persists the StepNode and advances the thread head exactly as it does today — only the agent invocation path changes
- The exit code is `0` and `stdout` carries the same JSON envelope as before (`{thread, head, status, currentRole, ...}`) so existing scripts continue to work
- `plog.log(PL_AGENT_SPAWN, ...)` no longer logs `spawning agent command=<binary>`; instead it logs the broker route, e.g. `broker.send role=<role> host=<host> gateway=<gateway>` with a fresh 8-char Crockford Base32 tag
- After a successful step the row at `sessionStore.getSession(threadId, role)` is non-null and points at the Sumeru session id used for that step, so the next `thread exec` reuses the session
