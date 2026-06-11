---
scenario: "@united-workforce/protocol exports nine CLI output JSON Schemas registered under @uwf/output/* names"
feature: protocol
tags: [protocol, schema, cli, output, envelope]
---

## Background

Issue #308 introduces an output envelope for every uwf CLI command. Each
command writes `{ type: <schemaHash>, value: <payload> }`, and the engine
must register a JSON Schema for each output type so the envelope can be
rendered, validated, and discovered downstream.

The nine schemas covering all CLI commands:

| Schema name                   | Command                | Required fields (top level)                                                                                                  |
| ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@uwf/output/thread-start`    | `uwf thread start`     | `threadId` (ULID string), `workflowHash` (CAS hash string)                                                                    |
| `@uwf/output/thread-status`   | `uwf thread show`      | `threadId`, `workflowHash`, `head` (CAS hash or null), `status`, `currentRole`, `suspendedRole`, `suspendMessage`, `done`     |
| `@uwf/output/thread-list`     | `uwf thread list`      | `items[]` of `{ threadId, workflowHash, workflowName, status, currentRole, startedAt, completedAt }`                          |
| `@uwf/output/thread-exec`     | `uwf thread exec`      | `steps[]` of `{ head, status, currentRole, done }`                                                                            |
| `@uwf/output/step-detail`     | `uwf step show`        | `hash`, `role`, `agent`, `status`, `startedAtMs`, `completedAtMs`, `durationMs`, `frontmatter`, `turns`                       |
| `@uwf/output/step-list`       | `uwf step list`        | `items[]` of `{ hash, role, durationMs }`                                                                                    |
| `@uwf/output/workflow-detail` | `uwf workflow show`    | `name`, `hash`, `version`, `description`, `roles`, `graph`                                                                    |
| `@uwf/output/workflow-list`   | `uwf workflow list`    | `items[]` of `{ name, hash, source, description }`                                                                           |
| `@uwf/output/validate-result` | `uwf workflow validate`| `valid` (boolean), `errors[]` (array of strings)                                                                              |

Each schema lives in `@united-workforce/protocol`'s `schemas.ts` (or a sibling
module re-exported from it) and is registered to CAS through the existing
schema registration flow (the same one that already registers
`WORKFLOW_SCHEMA`, `STEP_NODE_SCHEMA`, etc.).

## Given
- The protocol package exports nine new constants:
  `THREAD_START_OUTPUT_SCHEMA`, `THREAD_STATUS_OUTPUT_SCHEMA`,
  `THREAD_LIST_OUTPUT_SCHEMA`, `THREAD_EXEC_OUTPUT_SCHEMA`,
  `STEP_DETAIL_OUTPUT_SCHEMA`, `STEP_LIST_OUTPUT_SCHEMA`,
  `WORKFLOW_DETAIL_OUTPUT_SCHEMA`, `WORKFLOW_LIST_OUTPUT_SCHEMA`,
  `VALIDATE_RESULT_OUTPUT_SCHEMA`
- Each constant is a `JSONSchema` with a `title` matching the schema name
  (e.g. `"@uwf/output/thread-status"`) and `additionalProperties: false`
- A registration helper (e.g. `registerOutputSchemas(store)`) registers all
  nine schemas in CAS and binds the variable
  `@uwf/output/<short-name>` → `<casHash>` for each
- `uwf` initialises the CAS store at startup and ensures these registrations
  are present before any command runs (idempotent)

## When
- The CLI starts and any output-emitting command is invoked
- An external caller does `ocas schema list` after `uwf` has run at least once

## Then
- All nine `@uwf/output/<name>` variables resolve to non-empty 13-char
  Crockford Base32 hashes
- `ocas schema get <hash>` for each returns the exact JSON Schema defined in
  protocol — `additionalProperties: false`, the listed required fields, and
  no unspecified extras
- The `title` of each retrieved schema equals the constant name shown in the
  table above (e.g. `@uwf/output/thread-status`)
- Exporting the constants from protocol's `index.ts` (named exports only —
  no default exports) keeps `pnpm run typecheck` and `pnpm run check` green

## Field-level expectations

### `@uwf/output/thread-status`
- `threadId` is a 26-char Crockford Base32 string
- `workflowHash` is a 13-char Crockford Base32 string
- `head` is either a 13-char Crockford Base32 string or `null`
- `status` is one of `"idle" | "running" | "suspended" | "end" | "cancelled"`
- `currentRole`, `suspendedRole`, `suspendMessage` are `string | null`
- `done` is a boolean

### `@uwf/output/thread-list`
- `items` is an array (possibly empty)
- Each item carries the keys listed in the table; all timestamps are integers
  (epoch milliseconds) or `null` for not-yet-completed threads
- Order of items is left to the producer; the schema does not enforce ordering

### `@uwf/output/step-detail`
- `durationMs` is an integer ≥ 0 (when both timestamps are set) or `null`
- `frontmatter` is an object (the parsed agent frontmatter)
- `turns` is an array of objects with at least `role`, `content`,
  `timestamp` keys

### `@uwf/output/workflow-detail`
- `version` is an integer ≥ 1
- `roles` is an object (role-name → role-summary) — roles' nested system
  prompts are *not* expanded; only their names/descriptions are included
  so the rendered output stays at resolution=1
- `graph` is an object (role-name → object of status → target)

### `@uwf/output/validate-result`
- `valid` is a boolean
- `errors` is an array of strings (empty iff `valid` is `true`)

## Negative Case: producing an output that violates the schema fails fast

### Given
- A code path mistakenly writes a payload missing a required field
  (e.g. omits `threadId` from `thread-status`)

### When
- The CLI tries to wrap the payload in an envelope and emit it

### Then
- The CLI throws (or returns a `Result.err`) before writing to stdout — the
  output schema is treated as a contract, validated against the payload at
  the envelope-construction boundary
- The thrown error names the schema (`@uwf/output/thread-status`) and the
  missing field

## Edge Case: schema registration is idempotent

### Given
- Two `uwf` processes start in parallel against the same `~/.ocas/` store
- Neither has yet registered the output schemas

### When
- Both processes run `registerOutputSchemas(store)` concurrently

### Then
- The CAS hashes are deterministic, so both writes produce the same content
- The `@uwf/output/*` variable bindings end up identical regardless of
  which process wrote first
- No "duplicate" error surfaces; later runs are no-ops
