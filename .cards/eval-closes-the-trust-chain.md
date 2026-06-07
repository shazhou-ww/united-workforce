---
title: "Eval Closes the Trust Chain"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern]
category: "architecture"
links:
  - trust-chain-audit-evaluate-reuse
  - workflow-as-improvable-system
  - feedback-loops-convergent-and-divergent
---

信任链（可审查 → 可评估 → 可复用 → 可迭代）的"可评估"环节需要工程落地。

uwf 的 eval 包（`@united-workforce/eval`，已在 repo 开发中）的目标是让 agent 能自我评估执行质量——一次 thread 跑完后，度量"做得好不好"、"workflow v2 比 v1 好还是差"。

这形成了两层反馈闭环：
1. **workflow 内的反馈环** — developer → reviewer → rejected → developer（已实现，负反馈驱动执行质量收敛）
2. **workflow 级的反馈环** — 执行 → eval → workflow 迭代 → 再执行（在建，驱动流程本身的持续改进）

第二层闭环接通后，uwf 就不只是一个执行引擎，而是一个**自我改进的流程系统**。
