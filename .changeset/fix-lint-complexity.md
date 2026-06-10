---
"@united-workforce/cli": patch
"@united-workforce/util-agent": patch
---

Refactor to reduce cognitive complexity in spawnAgent and createAgent main functions. Extract helper functions to pass Biome's noExcessiveCognitiveComplexity check (limit 15). Fix array formatting in thread status filter.
