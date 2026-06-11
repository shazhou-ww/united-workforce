---
"@united-workforce/cli": minor
"@united-workforce/protocol": minor
---

**BREAKING**: `uwf` CLI commands now emit ocas envelopes (`{ type, value }`) by default, with text rendering as the default format.

Five output formats are supported via `--format`:

| Format | Shape | Use case |
|--------|-------|----------|
| `text` (default) | Liquid-rendered human-readable view | Interactive terminal use |
| `json` | `{"type": "<schemaHash>", "value": <payload>}` | Self-describing JSON for downstream parsers |
| `yaml` | YAML envelope (type, value keys) | Self-describing YAML |
| `raw-json` | bare `<payload>` | **0.5.0 backward compat** — drop-in replacement for old `json` |
| `raw-yaml` | bare `<payload>` | **0.5.0 backward compat** — drop-in replacement for old `yaml` |

Migration: scripts that consumed `uwf ... --format json` (parsing the bare value) must switch to `--format raw-json` to preserve the previous output shape, or update their parsers to read from the `value` field of the envelope.

New protocol exports:
- `OUTPUT_SCHEMAS` map and individual `*_OUTPUT_SCHEMA` constants for the 9 CLI output schemas (thread-start, thread-status, thread-list, thread-exec, step-detail, step-list, workflow-detail, workflow-list, validate-result)
- `OUTPUT_TEMPLATES` map and `outputSchemaVarName(name)` helper

The CLI registers all output schemas and `@ocas/template/text/<schemaHash>` templates idempotently on first use via `registerUwfSchemas`.

`uwf workflow validate` now emits a structured `validate-result` envelope on stdout (`✓ valid` / `✗ invalid (N errors)`) instead of writing errors to stderr; exit codes are preserved (0 for valid, 1 for invalid).
