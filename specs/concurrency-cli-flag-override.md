---
scenario: "--max-concurrent flag overrides config value for concurrency limit"
feature: thread
tags: [concurrency, cli, config, override]
---

## Given
- `concurrency.maxRunning` is set to 2 in `~/.uwf/config.yaml`
- A thread `T` is in idle state

## When
- `uwf thread exec <T> --max-concurrent 4` is run

## Then
- The concurrency limit used for slot acquisition is 4 (not the config value of 2)
- The slot is acquired with maxRunning=4
- The flag applies to all steps within this exec invocation
