---
scenario: "Default maxRunning is 2 when no config is provided"
feature: thread
tags: [concurrency, config, default]
---

## Given
- `~/.uwf/config.yaml` has no `concurrency` section

## When
- `uwf thread exec <T>` is run

## Then
- `resolveMaxRunning` reads config, finds no `concurrency.maxRunning` key
- The concurrency limit defaults to `DEFAULT_MAX_RUNNING = 2`
- At most 2 agent processes can run simultaneously across all exec invocations
