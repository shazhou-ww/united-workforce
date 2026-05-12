# Dashboard Workflow Graph Visualization

**Issue**: #198
**Status**: Draft
**Author**: xingyue

## Overview

在 Dashboard 的 ThreadDetail 页面中嵌入一个交互式流程图，将 workflow 的 `ModeratorTable` 可视化为有向图。用户可以一眼看到角色流转结构和当前执行进度。

## 数据流

### 问题：ModeratorTable 在 bundle 端，Dashboard 在前端

`ModeratorTable` 是运行时数据结构（包含 JS 函数引用如 `check`），无法直接序列化给前端。需要一个**静态图描述格式**作为中间层。

### 方案：扩展 WorkflowDescriptor

当前 `WorkflowDescriptor` 只有 roles + description，不包含转换图信息：

```ts
type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
};
```

**扩展为**：

```ts
type TransitionEdge = {
  condition: string;        // condition.name，或 "FALLBACK"
  description: string | null; // condition.description，FALLBACK 为 null
  target: string;           // role name 或 "__end__"
};

type WorkflowGraph = Record<string, TransitionEdge[]>;
// key = source role name 或 "__start__"

type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
  graph: WorkflowGraph | null;  // null = legacy bundles without graph
};
```

在 `buildDescriptor`（`workflow-register`）中，从 `ModeratorTable` 提取静态图结构。`condition.check` 函数不序列化，只保留 `name` 和 `description`。

### 数据暴露路径

```
ModeratorTable (runtime)
  → buildDescriptor() 提取 graph
    → descriptor.yaml 持久化
      → CLI serve /workflows API 返回
        → Dashboard 前端拿到 graph
```

同时需要新增或扩展一个 API，让 Dashboard 能拿到指定 workflow 的 descriptor（含 graph）：

```
GET /workflows/:name → { descriptor: WorkflowDescriptor }
```

或者在现有 `listWorkflows` 返回中附带。

## 前端渲染

### 库选型：React Flow + dagre

| 库 | 优势 | 劣势 |
|---|---|---|
| **React Flow** ✅ | React 原生、自定义节点/边、dagre 自动布局、~50KB gzip | 需要学 API |
| Mermaid | 声明式简单 | 无交互、无法高亮当前步骤 |
| D3 | 完全控制 | 太底层，手撸成本高 |
| Cytoscape | 图论强 | React 集成差 |

**依赖新增**：

```json
{
  "@xyflow/react": "^12",
  "@dagrejs/dagre": "^1"
}
```

### 图结构映射

```
WorkflowGraph → React Flow nodes + edges

节点:
  - __start__  → 圆形小节点（入口）
  - role       → 圆角矩形，显示 role name + description
  - __end__    → 圆形小节点（终止）

边:
  - FALLBACK   → 虚线（dashed），无 label
  - condition  → 实线，label = condition.name
                  hover tooltip = condition.description
```

### 布局

使用 dagre 自动计算 TB（top-to-bottom）方向布局：

```ts
import Dagre from "@dagrejs/dagre";

function layoutGraph(nodes, edges) {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 180, height: 60 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - 90, y: pos.y - 30 } };
  });
}
```

### 运行时高亮

ThreadDetail 已有 `records: ThreadRecord[]`，其中 `RoleRecord.role` 就是当前/历史执行的 role。

高亮逻辑：

```ts
function getNodeStates(records: ThreadRecord[]): Map<string, "completed" | "active"> {
  const states = new Map<string, "completed" | "active">();
  const roleRecords = records.filter((r) => r.type === "role");

  for (let i = 0; i < roleRecords.length; i++) {
    const role = roleRecords[i].role;
    states.set(role, i === roleRecords.length - 1 ? "active" : "completed");
  }

  // 如果有 workflow-result，最后一个 role 也是 completed
  if (records.some((r) => r.type === "workflow-result")) {
    for (const [k] of states) {
      states.set(k, "completed");
    }
    states.set("__end__", "completed");
  }

  states.set("__start__", "completed");
  return states;
}
```

节点样式：

| 状态 | 样式 |
|------|------|
| default | `border: var(--color-border)`, 暗色背景 |
| completed | `border: var(--color-success)`, 绿色边框 + ✓ 图标 |
| active | `border: var(--color-accent)`, 蓝色边框 + 脉冲动画 |

边高亮：当 source 和 target 都至少 completed 时，边变绿。

## 组件结构

```
workflow-dashboard/src/
  components/
    workflow-graph/
      types.ts           — TransitionEdge, NodeState 等前端类型
      index.ts           — export { WorkflowGraph }
      workflow-graph.tsx  — 主组件，React Flow canvas
      role-node.tsx       — 自定义 role 节点
      terminal-node.tsx   — START/END 圆形节点
      condition-edge.tsx  — 自定义边（虚线/实线 + label）
      use-layout.ts       — dagre 布局 hook
```

### 集成到 ThreadDetail

在 ThreadDetail 中，records 列表上方插入可折叠的图面板：

```tsx
// thread-detail.tsx
{graph && (
  <div className="mb-4 border rounded-lg overflow-hidden" style={{ height: 300 }}>
    <WorkflowGraph graph={graph} nodeStates={getNodeStates(records)} />
  </div>
)}
```

图高度固定 300px，React Flow 支持 pan + zoom，不影响下方 records 滚动。

## 分阶段实施

### Phase 1: 数据层 + 静态图

1. 在 `workflow-protocol` 中新增 `TransitionEdge` / `WorkflowGraph` 类型
2. 在 `workflow-register` 的 `buildDescriptor` 中从 `ModeratorTable` 提取 graph
3. `stringifyWorkflowDescriptor` / `validateWorkflowDescriptor` 支持 graph 字段
4. CLI serve 的 `/workflows` API 返回 descriptor（含 graph）
5. Dashboard 新增 `WorkflowGraph` 组件，静态渲染图

**产出**：打开 ThreadDetail 看到 workflow 流程图，无高亮。

### Phase 2: 运行时高亮

1. ThreadDetail 根据 records 计算 nodeStates
2. 节点/边样式响应状态变化
3. SSE live 模式下实时更新高亮

**产出**：正在运行的 thread 能看到当前执行到哪个 role。

### Phase 3: 交互增强

1. 点击节点滚动到对应 role 的 RecordCard
2. 边 hover 显示 condition description tooltip
3. 节点 hover 显示 role description + schema summary

**产出**：图和记录列表联动。

## 注意事项

- **向后兼容**：`graph` 字段为 `null` 时（旧 bundle），不渲染图，只显示 records
- **自循环边**：如 `coder → coder (FALLBACK)`，React Flow 支持自循环，dagre 需要特殊处理（self-edge 用 loop 路径）
- **大图性能**：dagre 在 <50 节点时性能无忧，workflow 通常 <10 个 role
- **暗色主题**：Dashboard 已使用 CSS variables，节点/边样式复用现有色板
- **不提交 pnpm-lock.yaml**

## 开放问题

1. **graph 放 descriptor 还是独立字段？** — 建议放 descriptor，因为它描述的就是 workflow 结构
2. **是否需要 WorkflowList 页也展示图？** — Phase 1 先只在 ThreadDetail，后续按需扩展
3. **`buildDescriptor` 需要 `ModeratorTable` 参数** — 当前 `buildDescriptor` 只接收 roles，需要扩展签名或在 bundle 注册时额外传入 table
