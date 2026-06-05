---
"@united-workforce/cli": patch
---

fix: expand bootstrap prompt with full onboarding and upgrade guide

Bootstrap now covers two scenarios:
- Fresh install: CLI + adapter installation, `uwf setup` configuration, skill installation, end-to-end verification
- Upgrade: package update, skill regeneration, breaking change migrations (e.g. $START new/resume)
