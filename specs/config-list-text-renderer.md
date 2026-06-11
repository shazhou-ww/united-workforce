---
scenario: "config list renders flat key-value pairs in text format"
feature: config
tags: [text-renderer, format, config]
---

## Given

- A valid config file exists at `~/.uwf/config.yaml` with content:
  ```yaml
  defaultAgent: claude-code
  agents:
    hermes:
      command: uwf-hermes
      args: []
    claude-code:
      command: uwf-claude-code
      args: []
  concurrency:
    maxRunning: 4
  ```
- The `TEXT_RENDERERS` registry in `format.ts` has a `"config list"` entry
- The `--format` flag is `text` (default)

## When

- Run `uwf config list`

## Then

- Output is rendered via the `"config list"` text renderer (not raw JSON)
- Output is a flattened key-value format, one line per leaf value:
  ```
  defaultAgent          claude-code
  agents.hermes.command uwf-hermes
  agents.hermes.args    []
  agents.claude-code.command uwf-claude-code
  agents.claude-code.args []
  concurrency.maxRunning 4
  ```
- Nested objects are flattened using dot-notation keys
- Array values are displayed as JSON (e.g. `[]`, `["--flag"]`)
- The renderer never throws on partial/missing data
