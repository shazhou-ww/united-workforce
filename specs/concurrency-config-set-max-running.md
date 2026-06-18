---
scenario: "uwf config set concurrency.maxRunning persists the concurrency limit"
feature: config
tags: [concurrency, config, walkthrough]
---

## Given
- `~/.uwf/config.yaml` exists (may or may not have a `concurrency` section)

## When
- `uwf config set concurrency.maxRunning 3`

## Then
- `~/.uwf/config.yaml` contains:
  ```yaml
  concurrency:
    maxRunning: 3
  ```
- Subsequent `uwf thread exec` commands use maxRunning=3 as the concurrency limit
- `uwf config get concurrency.maxRunning` returns `3`
