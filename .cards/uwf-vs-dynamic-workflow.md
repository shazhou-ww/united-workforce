---
title: "uwf vs Dynamic Workflow — Structural Differences"
created: "2026-06-07"
source: "openclaw-xiaomo"
tags: [architecture, decision]
category: "architecture"
links:
  - agency-over-content-not-process
  - deterministic-engine-uncertain-agent
  - session-isolation-as-cognitive-reset
  - cognitive-process-orchestration
  - workflow-as-improvable-system
---

Claude Code 的 dynamic workflow (dw) 和 uwf 都有 session 隔离——dw spawn 独立 subagent（最多 16 并发、1000 总量），每个 subagent 是独立 context，也能做对抗性 review。四个优势（认知隔离、注意力聚焦、上下文保鲜、流程可靠性）两者都具备。

差异不在能不能做 session 隔离和程序化流程，而在**流程和执行的解耦程度**：

dw 的流程生成和执行是一体的——同一个 agent 既决定怎么做又开始做。流程嵌在执行里。uwf 的 workflow 是独立的持久制品，不管是人写的还是 agent 写的，一旦存在就和任何一次执行无关，可以被单独审查、讨论、迭代。

这个解耦在三个维度上拉开差距：

**审查**：dw 的 JS 脚本是代码，审查门槛高，逻辑和业务细节混在一起。uwf 的 YAML 是声明式的，roles 定义关注点，graph 定义流转，一眼能看出流程结构，非工程师也能参与讨论。

**评估**：dw 每次生成不同脚本，难以控制变量——跑得好是流程好还是脚本碰巧写得好？uwf 的 workflow 固定，跑 N 次可以统计成功率，增减 role 后效果差异可以归因到流程变更。

**复用**：dw 脚本为特定任务生成，复用需要手动泛化。uwf 的 workflow 天然是通用模板——solve-issue 就是 solve-issue，换个 repo 换个 issue 直接跑。
