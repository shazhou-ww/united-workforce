---
title: "Workflow as an Improvable System"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern]
category: "architecture"
links:
  - uwf-vs-dynamic-workflow
  - process-discipline-from-software-engineering
  - feedback-loops-convergent-and-divergent
  - cognitive-process-orchestration
---

uwf 把 workflow 定位为**可持续改进的系统**，而不是一次性的任务完成工具。

LLM 能力在快速提升，但单次执行的可靠性永远有上限。真正的杠杆不在于某一次跑得好不好，而在于流程本身能不能从每次执行中学到东西、越来越好。这需要流程是可审查的（看得懂才能改）、可评估的（量化才能知道改对没有）、可复用的（积累才有复利）。

dw 每次重新生成脚本，某种意义上是在放弃之前执行的经验——每次从零开始发明流程。uwf 把流程固化为独立制品，每次迭代都在前一版基础上改进。v1 没有 tester 角色，加上 tester 变成 v2，效果可量化对比。

这是一个有记忆的系统——记忆不在 agent 的 context 里，而在 workflow 的版本历史里。
