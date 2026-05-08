# @uncaged/workflow-agent-cursor

`AgentFn` adapter that runs the `cursor-agent` CLI against a workspace path derived from the thread.

The agent builds a full prompt (system + task + step history via `@uncaged/workflow-util-agent`), extracts the absolute workspace path with your `extract` + Zod schema, then spawns `cursor-agent` with `--workspace`, model, and non-interactive flags.

## Install

```bash
bun add @uncaged/workflow-agent-cursor @uncaged/workflow @uncaged/workflow-util-agent zod
```

In this monorepo: `"@uncaged/workflow-agent-cursor": "workspace:*"` plus `workspace:*` for `@uncaged/workflow` and `@uncaged/workflow-util-agent`.

## Usage

```typescript
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";

const agent = createCursorAgent({
  model: null, // null → "auto"
  timeout: 0, // ms; 0 = no limit (spawnCli timeout disabled)
  extract: myExtractFn,
});
```

## API overview

| Export | Description |
|--------|-------------|
| `createCursorAgent(config)` | Returns `AgentFn` that runs `cursor-agent` with `buildAgentPrompt(ctx)` |
| `CursorAgentConfig` | `model`, `timeout`, `extract` (must supply workspace path) |
| `validateCursorAgentConfig` | Config validation result |
| `buildAgentPrompt` | Re-exported from `@uncaged/workflow-util-agent` |

Requires `cursor-agent` on `PATH` at runtime.
