# Changelog

## 0.1.2 — 2026-06-07

- fix: decouple session resume from isFirstVisit guard
  
  When frontmatter validation fails, the step is never written to CAS, so isFirstVisit remains true on the next run. Both adapters now always check the session cache regardless of isFirstVisit. When resuming after a frontmatter-only failure (isFirstVisit + cache hit), a minimal correction prompt is sent via buildFrontmatterRetryPrompt() instead of re-sending the full initial prompt.

