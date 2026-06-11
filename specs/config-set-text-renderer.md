---
scenario: "config set renders confirmation in text format"
feature: config
tags: [text-renderer, format, config]
---

## Given

- A valid config file exists
- The `TEXT_RENDERERS` registry in `format.ts` has a `"config set"` entry
- The `--format` flag is `text` (default)

## When

- Run `uwf config set defaultAgent hermes`

## Then

- Output is rendered via the `"config set"` text renderer (not raw JSON)
- Output confirms the key and new value in a human-readable format:
  ```
  defaultAgent = hermes
  ```
- For array values (e.g. `uwf config set agents.hermes.args '["--verbose"]'`):
  ```
  agents.hermes.args = ["--verbose"]
  ```
- The `writeRawOutput` call passes `"config set"` as the `commandPath` argument
- The renderer never throws on partial/missing data
