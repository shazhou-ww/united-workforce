# @uncaged/workflow-util

Shared utilities: encoding, IDs, logging, storage paths, and ref-field normalization.

## What This Package Does

It provides filesystem-safe Base32 and ULID generation, the structured logger used across packages, helpers for the default workflow data directory and global CAS path, and utilities to merge/normalize `refs` on steps. It re-exports `ok`/`err` from protocol for convenience.

## Key Exports

From `src/index.ts`:

- **Base32:** `CROCKFORD_BASE32_ALPHABET`, `decodeCrockfordBase32Bits`, `decodeCrockfordToUint64`, `encodeCrockfordBase32Bits`, `encodeUint64AsCrockford`
- **Logger:** `createLogger`
- **Refs:** `mergeRefsWithContentHash`, `normalizeRefsField`
- **Result:** `ok`, `err` (from `@uncaged/workflow-protocol`)
- **Paths:** `getDefaultWorkflowStorageRoot`, `getGlobalCasDir`
- **ULID:** `generateUlid`
- **Types:** `CreateLoggerOptions`, `LogFn`, `LoggerSink`, `Result`

## Dependencies

- **Workspace:** `@uncaged/workflow-protocol` — `Result` and shared types used by helpers

## Usage

```typescript
import { createLogger, getDefaultWorkflowStorageRoot, generateUlid } from "@uncaged/workflow-util";

const log = createLogger();
log("4KNMR2PX", "example");
```
