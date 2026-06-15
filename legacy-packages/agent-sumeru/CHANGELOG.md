# @united-workforce/agent-sumeru

> **⚠️ Archived (Phase 4 cleanup, #381):** This package is no longer
> published. Superseded by `@united-workforce/broker`. No further releases
> are planned.

This package never had a published changelog before being archived. Its
only published version (`0.1.0`) introduced the `uwf-sumeru` HTTP adapter
that bridged `uwf thread step` to a Sumeru gateway. That role has been
absorbed into `@united-workforce/broker`, which is invoked directly by
`@united-workforce/cli` rather than spawning a per-step CLI subprocess.
