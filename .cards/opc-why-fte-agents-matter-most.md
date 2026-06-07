---
title: "OPC — Why One Person Companies Need FTE Agents Most"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, pattern, decision]
category: "architecture"
links:
  - agent-as-graduate
  - process-authorship-human-ai-vs-delegation
  - workflow-as-improvable-system
  - domain-experts-own-the-process
---

One Person Company (OPC) 是 FTE 型 agent 价值主张最清晰的场景。

OPC 的核心矛盾：一个人要覆盖所有职能（产品、开发、测试、运营、客服、财务），不可能精通所有领域，但每个领域都需要靠谱的流程保证质量。

Vendor 型 agent 适合偶发性、标准化任务——生成图片、翻译文档，用完即走。FTE 型 agent 适合核心业务流程——反复执行、有领域特殊性、出错成本高的环节。

OPC 不是"一个人用很多工具"，而是"一个 CEO 管一个全 agent 团队"。全用 vendor 型 agent，CEO 是人肉编排器——每个任务都要自己拆、分配、检查、决定下一步，agent 越多协调开销越大，CEO 本人成为系统瓶颈。

FTE agent 解决的是 **delegation 的深度**。vendor 只能委托一个任务，FTE 可以委托一个职能——"你负责所有 PR 的 code review，按这个流程做"。Workflow 是这个委托的载体，编码了做事方法，agent 在流程里自主运转。

CEO 从操作者变为流程的设计者和监督者，关注"流程对不对"而不是"这一步做得对不对"。带宽从 O(任务数) 降到 O(流程数)。任务无限多，但流程是有限的、收敛的。

OPC 比大公司更需要 FTE 型 agent，因为：

1. **没有团队兜底** — 没有同事补漏，流程可靠性是生命线
2. **流程就是竞争力** — OPC 的护城河往往是创始人多年积累的做事方法，需要被编码、复用、持续优化
3. **规模化靠流程不靠人** — 增长不能靠招人，只能靠让 agent 承担更多职能，而承担职能需要真正融入业务流程
4. **CEO 不能是瓶颈** — FTE agent 独当一面，CEO 才能从协调者变成决策者

uwf 在 OPC 场景的价值：把创始人脑子里的流程变成可执行、可迭代的资产，让 FTE agent 成为 CEO 的左膀右臂，而不是需要时刻看管的外包。
