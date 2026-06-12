---
"@united-workforce/cli": patch
---

Fix test suite polluting global CAS store (~/.ocas/)

- Add vitest `globalSetup` to detect `OCAS_HOME`/`UWF_HOME` env var leaks between test files
- Centralize `makeUwfStore` helper into `thread-test-helpers.ts` (was copy-pasted in 10 files)
- Add `OCAS_HOME` save/restore in `afterEach` for all 13 leaking test files
- Add `afterEach` cleanup to `thread-cancel-status.test.ts` and `store-unified-threads.test.ts` (had none)
