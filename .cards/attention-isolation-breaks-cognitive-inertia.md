---
title: "Attention Isolation Breaks Cognitive Inertia"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern]
category: "architecture"
links:
  - session-isolation-as-cognitive-reset
  - skill-vs-workflow-different-layers
  - role-is-not-agent
---

"知识都在一个 session 内不是更好吗？"——这个直觉混淆了**信息量**和**认知模式**。

Session 隔离去掉的不是信息，而是**不该影响当前判断的信息**。reviewer 通过 CAS 链拿到 developer 的全部产出物（代码、变更说明），它缺的是 developer 的内心独白——为什么选方案 A、哪里犹豫过、哪里偷了懒。

这恰恰是关键。知道"为什么"的 reviewer 会顺着作者的逻辑走；不知道"为什么"的 reviewer 只能看产出物本身是否站得住——就像真实用户或未来维护者的视角。与学术双盲评审同理：去掉不该影响判断的信息，让注意力聚焦在工作本身。

每个认知任务需要的信息集合不同。developer 需要 issue 上下文、代码库知识、技术约束；reviewer 需要 diff、规范、测试结果。混在一起不是多了信息，是多了噪声。

**关注点的隔离是打破惯性和线性思维的关键。** 一个 session 做所有事，不是"知识都在"，是关注点混在一起，确认偏误无法靠 prompt 消除，只能靠结构隔离。
