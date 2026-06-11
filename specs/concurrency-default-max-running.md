---
scenario: "Default maxRunning is 2 when no config or flag is provided"
feature: thread
tags: [concurrency, config, default]
---

## Given
- `~/.uwf/config.yaml` has no `concurrency` section
- No `--max-concurrent` flag is passed

## When
- `uwf thread exec <T>` is run

## Then
- The concurrency limit defaults to `DEFAULT_MAX_RUNNING = 2`
- At most 2 agent processes can run simultaneously across all exec invocations
