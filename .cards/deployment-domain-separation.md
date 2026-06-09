---
title: "Deployment Domain — Service 域 vs User 域"
created: "2026-06-09"
source: "xiaonuo-shazhou"
tags: [architecture, decision]
category: "architecture"
links:
  - domain-experts-own-the-process
  - agent-as-graduate
  - process-authorship-human-ai-vs-delegation
---

UWF 将从纯客户端架构演进为服务模式，通过部署域划分实现架构级隔离：

**Service 域（研发团队）**：部署底层代码、引擎逻辑、Agent Adapter 实现。这是技术基础设施，需要工程能力维护。

**User 域（业务专家/用户）**：迭代自己域内的 Skill 和 Workflow 配置。这是业务知识的表达，不需要代码能力。

隔离的三重意义：

1. **风险隔离**：非技术用户不会误改 Agent 代码逻辑——在 User 域内的操作被限定在配置层面。
2. **需求回流**：用户在 User 域遇到的技术瓶颈，通过 Suspend 和 Ask 自然暴露，形成从业务需求到研发工单的全链路通道。
3. **自主演化**：每个团队在自己的域内独立迭代 Workflow，无需等待研发排期。

这与 [[domain-experts-own-the-process]] 一脉相承——让领域专家真正拥有流程的所有权，同时通过架构隔离保障系统稳定性。
