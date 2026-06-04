export function generateBootstrapReference(): string {
  return `---
name: uwf
description: "United Workforce (uwf) — YAML 状态机工作流引擎。任务涉及 workflow 时加载此 skill。"
tags: [workflow, uwf]
triggers:
  - uwf
  - workflow
  - 工作流
---

# uwf (United Workforce)

YAML 状态机工作流引擎。当用户提到「workflow」「工作流」时，指的是 **uwf workflow**（YAML 定义的状态机），不是 Hermes skill。用 \`uwf\` CLI 操作，不要混淆。

## 首次使用

运行以下命令获取完整用法：

\`\`\`bash
uwf prompt usage                 # 完整用法文档（所有引用合并）
uwf prompt workflow-authoring    # workflow 编写指南（role 定义、graph 路由、schema）
uwf prompt adapter-developing    # adapter 开发指南（构建新的 agent adapter）
\`\`\`

## 快速参考

\`\`\`bash
uwf workflow list                          # 查看已注册 workflow
uwf workflow add <file.yaml>               # 注册 workflow
uwf thread start <workflow> -p "prompt"    # 创建 thread
uwf thread exec <thread-id> -c 10          # 执行最多 10 步
uwf thread list                            # 查看所有 thread
\`\`\`

## 示例 workflow

参考项目 \`examples/\` 目录下的 YAML 文件（analyze-topic、debate、solve-issue）。
`;
}
