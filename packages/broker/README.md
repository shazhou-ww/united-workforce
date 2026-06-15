# @united-workforce/broker

Session-mapping persistence layer for the uwf broker.

## Phase 1 Scope (#378)

This package currently exposes the SQLite-backed session-mapping store used to
remember which Sumeru session a given `(threadId, role)` pair is talking to.
It does NOT include the HTTP broker, agent process management, or any CLI
integration — those are tracked separately:

- #364 — parent broker design
- #378 — Phase 1: session-mapping persistence (this package, today)
- #379 — Phase 2: Sumeru HTTP client
- #380 — Phase 3: CLI integration
- #381 — Phase 4: lifecycle / GC

## Public API

```typescript
import { createSessionStore } from "@united-workforce/broker";
import type {
  SessionInput,
  SessionRecord,
  SessionStore,
} from "@united-workforce/broker";

const store = createSessionStore({ dbPath: "/tmp/sessions.db" });

// upsertSession: insert OR replace (preserves createdAt on update)
store.upsertSession({
  threadId: "06FCHRTFS6STQY3ET1355NXYS0",
  role: "planner",
  host: "http://127.0.0.1:7900",
  gateway: "claude-code",
  sessionId: "ses_abc",
});

// getSession: returns SessionRecord | null
const row = store.getSession("06FCHRTFS6STQY3ET1355NXYS0", "planner");

// listByThread: returns rows sorted by role ASC
const rows = store.listByThread("06FCHRTFS6STQY3ET1355NXYS0");

// deleteByThread: returns rows-deleted count
const count = store.deleteByThread("06FCHRTFS6STQY3ET1355NXYS0");

store.close();
```

When `dbPath` is omitted, the store opens
`<getDefaultStorageRoot()>/broker/sessions.db` (e.g. `~/.uwf/broker/sessions.db`).
The directory is created on first use.

## Storage

- Single SQLite database (Node's built-in `node:sqlite`, no native deps).
- Schema migration is idempotent — running `createSessionStore` twice against
  the same path is a no-op after the first run.
- WAL journal mode so concurrent reads from `uwf thread list` don't block
  writers.
