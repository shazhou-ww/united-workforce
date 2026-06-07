---
title: "When Skill Is Not Enough — Workflow Judgment Call"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision, pattern]
category: "architecture"
links:
  - skill-vs-workflow-different-layers
  - attention-isolation-breaks-cognitive-inertia
  - feedback-loops-convergent-and-divergent
  - agency-over-content-not-process
---

**Skill 够用的场景：** 任务在单一认知模式下可以完成好。查资料、写文档、跑部署脚本、按规范格式化——不需要自我对抗，一个 session 带着清晰指令一路执行到底就行。

**Workflow 更好的场景：** 任务需要在不同认知模式之间切换，且这些模式之间存在张力。典型标志：

1. **产出需要被"不知道过程"的眼睛审视** — 写代码+review、写方案+挑战、翻译+校对。一个 session 做不到真正的自我审视，确认偏误是自回归结构决定的，不是 prompt 能修的。

2. **出错成本高到需要结构性保证** — 不是"建议你 review 一下"，而是"你不可能跳过 review"。Skill 是建议，workflow 是制度。

3. **需要收敛到明确的质量标准** — 负反馈环驱动修正直到通过，而不是 agent 自己觉得"差不多了"。

**判词：当任务复杂到 agent 可能说服自己"错的是对的"时，你需要 workflow 的结构隔离，而不是 skill 的行为指导。**
