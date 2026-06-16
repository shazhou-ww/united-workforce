---
id: step-detail-output-schema
title: "The step-detail CLI output schema (@uwf/output/step-detail)"
sources:
  - packages/protocol/src/output-schemas.ts
tags: [architecture, protocol, json-schema, step-detail, output-envelope, realtime-turns]
created: 2026-06-16
updated: 2026-06-16
---

# The step-detail CLI output schema (@uwf/output/step-detail)

`output-schemas.ts` defines the JSON Schemas for every uwf CLI command output.
This card documents **only the step-detail schema** and its sub-schemas — the
contract that validates what `uwf step show` emits. The other nine schemas are
indexed at the bottom for orientation but are out of scope here.

## The self-describing output-envelope convention

Every CLI command envelopes its payload as:

```
{ type: <schemaHash>, value: <payload> }
```

so the output is **self-describing** and pipeable into `ocas render -p`. Each
schema is registered in CAS under a short name and bound to the variable
`@uwf/output/<name>` via `outputSchemaVarName(name)` (`return
"@uwf/output/" + name`). The `<schemaHash>` in the envelope is the CAS hash of
the registered schema (the binding/registration is performed by
`registerOutputSchemas` in `schemas.ts` — see the **`uwf-store`** card).

`OUTPUT_SCHEMAS` is the short-name → schema map; `OutputSchemaName` is its key
union. `step-detail` maps to `STEP_DETAIL_OUTPUT_SCHEMA`.

A module-wide rule: **top-level output schemas use `additionalProperties:
false`** so unknown fields are caught at the envelope-construction boundary.

## `STEP_DETAIL_OUTPUT_SCHEMA` — the envelope value

`title: "@uwf/output/step-detail"`, `type: "object"`,
`additionalProperties: false`. **All eleven** properties are `required`:

| Field | Type | Notes |
|-------|------|-------|
| `hash` | `string` | the step's CAS hash |
| `role` | `string` | workflow role |
| `agent` | `string` | agent/gateway name |
| `status` | `string` | derived from the output's `$status` (or `""`) |
| `startedAtMs` | integer \| null | `NULLABLE_INTEGER` |
| `completedAtMs` | integer \| null | `NULLABLE_INTEGER` |
| `durationMs` | integer \| null | `NULLABLE_INTEGER` |
| `usage` | `STEP_DETAIL_USAGE` | usage-object \| null |
| `frontmatter` | `object` (`additionalProperties: true`) | the extracted role frontmatter |
| `turns` | array of `STEP_DETAIL_TURN` | rendered agent turns |
| `detail` | `STEP_DETAIL_NESTED` | raw broker-detail object \| null |

`NULLABLE_INTEGER` / `NULLABLE_STRING` are shared helpers
(`anyOf: [{type}, {type:"null"}]`) used for the optional timing fields.

## Sub-schemas

### `STEP_DETAIL_TURN` (permissive)

```
type: "object"
required: ["role", "content", "timestamp"]
properties: { role: string, content: string, timestamp: integer|null }
additionalProperties: true   // ← permissive
```

`role`, `content`, and `timestamp` are required (timestamp nullable). It is
**permissive** (`additionalProperties: true`) — one of three permissive shapes
in the step-detail tree, alongside `STEP_DETAIL_NESTED`'s object branch and the
inline `frontmatter` subschema (all three carry adapter-owned, open-ended data).

### `STEP_DETAIL_USAGE` (anyOf object | null)

```
anyOf:
  - { type: object,
      required: [turns, inputTokens, outputTokens, duration],
      properties: { turns:int, inputTokens:int, outputTokens:int, duration:number },
      additionalProperties: false }
  - { type: null }
```

A fully-specified usage object **or** `null`. Note `duration` is `number` (not
`integer`) while the three token/turn counts are `integer`.

### `STEP_DETAIL_NESTED` (anyOf object | null)

```
anyOf:
  - { type: object, additionalProperties: true }
  - { type: null }
```

Holds the **raw broker-detail object** (`{ sessionId, duration, turnCount,
turns }` and whatever else the adapter wrote) unconstrained, or `null`. It is
permissive on purpose — the nested detail is opaque pass-through, not a field
the envelope boundary polices.

## Why `STEP_DETAIL_TURN` is permissive while top-level schemas are strict

The top-level output schemas are **strict** (`additionalProperties: false`) so
that a typo or stray field in CLI-constructed output is caught immediately at
the envelope boundary — the CLI controls those fields, so unknown keys signal a
bug.

`STEP_DETAIL_TURN` (and `STEP_DETAIL_NESTED`) are **permissive**
(`additionalProperties: true`) because turns originate from **adapter / agent
output**, not the CLI. Different agents attach different per-turn extras (e.g.
tool-call metadata, indices, provider-specific fields); forbidding unknown keys
would reject otherwise-valid turns. Permissiveness lets **adapter turn extras
survive** validation while still enforcing the `role`/`content`/`timestamp`
core. In short: strict where the CLI owns the shape, permissive where an
external adapter owns it.

## Relationship to `cmdStepShow`

This schema is the contract for `uwf step show` output. `cmdStepShow`
(see the **`step-commands`** card) builds the metadata+detail merge — its
literal return value supplies `hash`, `role`, `agent`, `status`, `startedAtMs`,
`completedAtMs`, `durationMs`, `usage`, and `detail`, with `status` derived from
the step output's `$status` and the timing fields guarded to finite numbers (so
they land as integer-or-null exactly as `NULLABLE_INTEGER` allows). The schema's
`required` set is a **superset** of that literal return: it additionally requires
`frontmatter` (the extracted role frontmatter) and `turns` (the array of
`STEP_DETAIL_TURN`), which the command/envelope layer supplies to complete the
step-detail contract before enveloping. The nested `detail` validates against
`STEP_DETAIL_NESTED`, matching the opaque broker-detail object `expandDeep`
produces. The `turns` array shape mirrors the per-turn nodes
`broker-step.ts` persists (cross-link **`broker-step-execution`**).

## Other output schemas (index only — out of scope)

The same file defines nine other `@uwf/output/*` schemas, listed here for
orientation only: `thread-start`, `thread-status`, `thread-list`,
`thread-exec`, `step-list`, `workflow-add`, `workflow-detail`, `workflow-list`,
`validate-result`. All follow the same strict top-level + `@uwf/output/<name>`
binding convention.

## Cross-links

- **`step-commands`** — `cmdStepShow` produces the object this schema validates.
- **`broker-step-execution`** — writes the turn/detail CAS nodes whose shape the
  `turns` / `detail` sub-schemas describe.
- **`uwf-store`** — `registerOutputSchemas` registers each schema and binds
  `@uwf/output/<name>`.
