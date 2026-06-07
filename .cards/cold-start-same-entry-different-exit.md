---
title: "Cold Start — Same Entry Point, Different Exit"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern]
category: "architecture"
links:
  - uwf-vs-dynamic-workflow
  - process-authorship-human-ai-vs-delegation
  - workflow-as-improvable-system
  - agent-as-graduate
---

uwf 的冷启动不比 dw 更复杂——起点完全一样：用户描述任务，agent 执行。

区别在出口：dw 跑完即丢，uwf 跑完后沉淀成 workflow YAML，用户可以审查、调优、复用。workflow 不一定要用户写，往往也是 agent 写的——跟 dw 一样的模式。uwf 和 dw 的差异不在"谁写流程"，而在"流程跑完后去哪"。

冷启动路径：agent 先跑一次临时流程 → 用户觉得好就固化成 workflow → 下次同类任务直接复用 → 用过几次后根据经验调优。从零门槛的即兴执行，渐进演化为成熟的可复用流程。

入口像 dw 一样低，出口比 dw 多了一个沉淀层。
