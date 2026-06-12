---
"@united-workforce/protocol": patch
"@united-workforce/cli": patch
---

Fix `uwf thread list --format text` rendering year `58414-12-06` (issue #351). The `THREAD_LIST_TEMPLATE` in `packages/protocol/src/output-templates.ts` piped `item.startedAt` (Unix milliseconds, per `THREAD_LIST_OUTPUT_SCHEMA`) directly into LiquidJS's `| date` filter, which expects Unix seconds. The template now converts ms→s via `| divided_by: 1000` before `| date`, so `STARTED` cells render correctly (e.g. `2026-06-12 05:25`). Adds protocol-level regression-guard tests that reject any future template piping a ms-typed schema field (`startedAt`, `completedAt`, `startedAtMs`, `completedAtMs`, `timestamp`) into `| date` without prior conversion.
