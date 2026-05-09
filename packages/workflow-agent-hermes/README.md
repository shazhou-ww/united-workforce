# @uncaged/workflow-agent-hermes

`AgentFn` adapter that runs the `hermes` CLI in non-interactive `chat` mode (Nerve-style flags: `-q`, `--yolo`, `--quiet`, bounded `--max-turns`).

The agent composes the same thread-aware prompt as other CLI-backed agents via `buildAgentPrompt` from `@uncaged/workflow-util-agent`, then spawns `hermes` and returns stdout on success.

## Install

```bash
bun add @uncaged/workflow-agent-hermes @uncaged/workflow-runtime @uncaged/workflow-util-agent
```

In this monorepo: use `workspace:*` for `@uncaged/workflow-agent-hermes`, `@uncaged/workflow-runtime`, and `@uncaged/workflow-util-agent`.

## Usage

```typescript
import { createHermesAgent } from "@uncaged/workflow-agent-hermes";

const agent = createHermesAgent({
  model: "your-model", // or null to omit --model
  timeout: 600_000, // ms, or null for no timeout
});
```

## API overview

| Export | Description |
|--------|-------------|
| `createHermesAgent(config)` | Returns `AgentFn` wrapping `hermes chat -q ...` |
| `HermesAgentConfig` | `model`, `timeout` |
| `validateHermesAgentConfig` | Config validation result |

Requires `hermes` on `PATH` at runtime.
