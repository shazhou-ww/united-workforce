---
scenario: "Phase 2 additions live inside the existing @united-workforce/broker package and follow the folder-module discipline"
feature: broker
tags: [broker, structure, conventions, package]
---

## Given
- Phase 1 created `packages/broker/` with `src/index.ts`, `src/types.ts`, and `src/session-store/` (folder module)
- Phase 2 adds the Sumeru HTTP client and `broker.send()` orchestration to the SAME package — no new package, no new binary
- The repo enforces functional-first style (`type` over `interface`, `function` over `class`, no `?:`, named exports only, structured logger via `@united-workforce/util`)

## When
- A developer inspects the post-Phase-2 layout of `packages/broker/`

## Then
- New code is organised as folder modules under `packages/broker/src/`:
  - `sumeru-client/` containing `index.ts` (pure re-exports), `types.ts` (e.g. `SumeruClient`, `SumeruSendOutcome`, `SumeruSessionNotFoundError`), and implementation files (`sumeru-client.ts`, `sse.ts`, etc.)
  - `send/` (or equivalent name) containing `index.ts`, `types.ts`, and `send.ts` for the `broker.send()` orchestration
- `packages/broker/src/index.ts` is updated to re-export the new public surface: `createSumeruClient`, `send` (or `createBroker` factory), and the corresponding types — no implementations live in `index.ts`
- No file outside a folder module's `index.ts` re-exports another module's internals
- All new types live in their folder's `types.ts`, never in `index.ts`
- All new logging uses `createLogger()` from `@united-workforce/util` with hand-written 8-char Crockford Base32 tags; no `console.*` calls
- All new code uses `async/await` (no `.then()` chains) and `function` declarations (no classes except `SumeruSessionNotFoundError extends Error`)
- The package's `package.json` declares any new direct dependencies needed (none expected — `fetch` is global in Node 18+) and continues to depend on `@united-workforce/protocol` and `@united-workforce/util` via `workspace:^`
- `pnpm run build`, `pnpm run check`, and `pnpm run typecheck` all pass at the workspace root
