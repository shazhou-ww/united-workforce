---
title: "Agent as Graduate — Not Outsource, Not Genius Intern"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision, pattern]
category: "architecture"
links:
  - process-authorship-human-ai-vs-delegation
  - domain-experts-own-the-process
  - workflow-as-improvable-system
  - trust-chain-audit-evaluate-reuse
---

交付给用户的 agent buddy 不应该只是装备了行业 know-how 的特定任务执行者，而应该是可以和用户共同讨论、适应到客户实际业务流程中的**"毕业生"**。

毕业生有专业知识、有执行能力、学东西快，但不了解公司的具体流程——不知道哪个环节是因为三年前出过事故才加上的，不知道这个审批为什么要过两道。好的毕业生跟着老师傅一边干一边学，理解流程背后的原因，逐渐能独立执行甚至提出改进建议。

Workflow 就是这个**带教结构**。行业专家把经验编码到 workflow 里，agent 在这个框架下执行。随着磨合，workflow 本身也在迭代——某个环节发现不需要了，某个地方需要加一道校验。

定位的核心差异：我们交付的是 **new graduates as FTEs**，而非 **professional vendors**。

Vendor 交付结果——你不关心他内部怎么运作，合同到期换一家也行。FTE 毕业生交付的是融入——你花时间带他、把流程教给他、他理解你的业务逻辑，这个投入随时间产生复利。

三种模式的对比：

- **Skill 模式（外包）** — 丢任务过去不管怎么做只看结果。能用，但不成长，不适应业务。
- **dw 模式（天才实习生）** — 每次自己想一套做法，可能很惊艳，但不积累、不传承、不跟团队形成默契。
- **uwf 模式（FTE 毕业生）** — 在团队流程中工作，流程和人相互适应，共同成长。

uwf 所有设计选择都在支撑 FTE 模式：可审查（看得懂他在做什么）、可评估（衡量做得好不好）、可迭代（持续改进工作方式）、session 隔离（流程纪律靠结构而非自觉）。
