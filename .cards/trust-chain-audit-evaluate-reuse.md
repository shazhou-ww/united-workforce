---
title: "Trust Chain — Auditable → Evaluable → Reusable → Improvable"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern, decision]
category: "architecture"
links:
  - workflow-as-improvable-system
  - uwf-vs-dynamic-workflow
  - process-discipline-from-software-engineering
---

可审查、可评估、可复用不是并列的好处，而是一条因果链：

**可审查 → 可评估 → 可复用 → 可迭代**

不能审查的东西不敢复用——不知道它为什么 work，换个场景可能就 break。不能评估的东西不知道该不该复用——也许它其实没用，只是恰好那次任务简单。

这是一条信任链，每一环是下一环的前提。uwf 选择声明式 YAML 而不是 JS/TS 定义 workflow，不是技术限制，是有意降低审查门槛，让这条链的摩擦力最低。

dw 不是不能做这些，而是它的默认路径不鼓励这条链——即兴生成的脚本，审查成本高、评估缺乏对照、复用需要额外抽象。差异在摩擦力，不在能力边界。

这也是耗散结构的递归应用——不只是用流程对 agent 做负反馈（提升执行质量），还在对流程本身做负反馈（提升流程质量）。Workflow 和代码一样，需要 review、测试、度量、迭代。
