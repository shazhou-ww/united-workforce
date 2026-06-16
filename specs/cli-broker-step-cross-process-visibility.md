---
scenario: "while a slow step runs in process A, an independent process B can read the growing turn-hash list from the SQLite-backed active var before the step completes (core user value)"
feature: thread
tags: [cli, broker-step, turns, active-var, cross-process, sqlite, integration, phase2, "398"]
---

## Given
- Phase 2 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`). This is the **core user value**:
  "一个 step 跑到一半时，**另一个独立进程**能查到已经产生的中间 turn".
- The active var `@uwf/active-turns/<threadId>/<role>` is persisted by the ocas **SQLite** var
  store, which is process-shared. Per the `uwf-store` card, the var/tag SQLite DB lives **inside the
  global CAS dir**, NOT under `UWF_HOME`:
  - `createUwfStore` calls `createSqliteVarStore(join(getGlobalCasDir(), "vars"), cas)`
    (`packages/cli/src/store.ts`).
  - `getGlobalCasDir()` = `OCAS_HOME` (default `~/.ocas`).
  - The ocas sqlite store writes the file **`_store.db`** inside that dir
    (`~/repos/ocas/packages/fs/src/sqlite-store.ts`, `DB_FILE = "_store.db"`), table **`vars`**,
    columns `(name, schema, value, ...)` where `value` is the CAS hash the var points at.
  - ⇒ The real on-disk path is **`~/.ocas/vars/_store.db`**, table **`vars`** — **not** the
    `~/.ocas/variables.db` / table `variables` literally written in issue #398's Step 4. The
    issue's `sqlite3` command is illustrative; the **correct** probe is:
    ```bash
    sqlite3 ~/.ocas/vars/_store.db \
      "SELECT value FROM vars WHERE name LIKE '@uwf/active-turns/<tid>/%'"
    ```
    (This path correction is part of the spec so the cross-process check does not fail spuriously.)
- Because SQLite WAL makes committed writes visible to other connections, a **second process** that
  opens the same DB sees each appended turn once its read-modify-write commits — without any IPC.
- A test-only **slow mock adapter/broker** sleeps between emitting turns so the step stays in-flight
  long enough for a second reader to observe intermediate state.

## When
- **Process A** starts a slow step that emits 3 assistant turns with a delay between each:
  ```bash
  uwf thread exec <tid> --count 1 &      # backgrounded; mock adapter sleeps per turn
  ```
- **Process B**, while A's step is still running (not yet completed), reads the active var directly
  from SQLite:
  ```bash
  sqlite3 ~/.ocas/vars/_store.db \
    "SELECT value FROM vars WHERE name LIKE '@uwf/active-turns/<tid>/%'"
  ```
  (Equivalently, any second `createUwfStore` / `varStore.list({ namePrefix: "@uwf/active-turns/<tid>/" })`.)

## Then
- Process B observes a **non-empty** result **before** process A's step completes — the active var
  exists and its pointed-at array node already holds the turn hashes produced so far.
- The observed turn-hash count **increases over time** as A appends (e.g. B sampling at intervals
  sees 1, then 2, then 3) — progress is visible mid-step, not only at the end.
- Each observed turn hash is resolvable in the shared CAS to a `{ role: "assistant", content }`
  node — process B can read the actual intermediate content another process produced.
- After process A's step **completes**, the active var is **gone** (solidified + deleted per
  `cli-broker-step-solidify-detail-turns.md`); B's subsequent SQLite probe of
  `@uwf/active-turns/<tid>/%` returns **empty**, and the same turns are now durably under the
  step's immutable `detail.turns` (readable via `uwf step show <stepHash>`).
- Net user-visible outcome: a long-running step's progress is observable from an independent
  process **mid-flight**, and on completion the same turns are frozen into the step detail — turns
  are never lost to "only the final output survived."

## Notes
- Phase 2's acceptance for this step is the **cross-process visibility of the active var via
  SQLite** (above). The ergonomic `uwf step turns <tid> --role <r>` / `--live` consumer command is
  **Phase 4 (#... )**, explicitly out of scope here; do not require that subcommand for #398.
- The RFC/issue example using `~/.ocas/variables.db` and `WHERE name LIKE '@uwf/active-turns/...'`
  is directionally correct but the **filename/table are `vars/_store.db` / `vars`** in the current
  ocas implementation — a tester should use the corrected path above.
- This is an integration/visibility assertion layered on the unit-level guarantees from the other
  three #398 specs (append, solidify, crash-clear); it does not introduce new persistence behavior,
  only asserts that the SQLite-backed var is genuinely visible across processes mid-step.
