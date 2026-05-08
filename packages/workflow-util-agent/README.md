# @uncaged/workflow-util-agent

Shared helpers for CLI-backed workflow agents: assemble prompts from thread context and spawn subprocesses with timeouts.

Used by `@uncaged/workflow-agent-cursor` and `@uncaged/workflow-agent-hermes`. Depends on `@uncaged/workflow` for CAS reads (`getContentMerklePayload`) and `Result` typing.

## Install

```bash
bun add @uncaged/workflow-util-agent @uncaged/workflow
```

In this monorepo: `workspace:*` for both packages.

## Usage

```typescript
import { buildAgentPrompt, spawnCli } from "@uncaged/workflow-util-agent";

const prompt = await buildAgentPrompt(agentContext);
const result = await spawnCli("my-cli", ["--json"], { cwd: "/tmp", timeoutMs: 60_000 });
if (!result.ok) { /* handle SpawnCliError */ }
const stdout = result.value;
```

## API overview

| Export | Description |
|--------|-------------|
| `buildAgentPrompt(ctx)` | System prompt + task + prior step summaries + latest body from CAS; appends `uncaged-workflow thread <id>` tool hint |
| `spawnCli(cmd, args, { cwd, timeoutMs })` | `Promise<Result<string, SpawnCliError>>`; captures stdout, non-zero exit and spawn failures as `err` |
| `SpawnCliConfig` | `cwd: string \| null`, `timeoutMs: number \| null` |
| `SpawnCliError` | `non_zero_exit` \| `timeout` \| `spawn_failed` |
| `SpawnCliResult` | Alias for `Result<string, SpawnCliError>` |
