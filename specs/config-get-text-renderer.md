---
scenario: "config get renders value in text format"
feature: config
tags: [text-renderer, format, config]
---

## Given

- A valid config file exists with `defaultAgent: claude-code`
- The `TEXT_RENDERERS` registry in `format.ts` has a `"config get"` entry
- The `--format` flag is `text` (default)

## When

- Run `uwf config get defaultAgent`

## Then

- Output is rendered via the `"config get"` text renderer (not raw JSON)
- For scalar values, output is the bare value string:
  ```
  claude-code
  ```
- For object values (e.g. `uwf config get agents.hermes`), output is flattened key-value:
  ```
  command uwf-hermes
  args    []
  ```
- The `writeRawOutput` call passes `"config get"` as the `commandPath` argument
- The renderer never throws on partial/missing data
