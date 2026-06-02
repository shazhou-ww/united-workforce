# Dashboard Workflow Graph Visualization

**Issue**: #198
**Status**: In Progress
**Author**: xingyue

## Overview

在 Dashboard 的 ThreadDetail 页面中嵌入一个交互式流程图，将 workflow 的 `ModeratorTable` 可视化为有向图。用户可以一眼看到角色流转结构和当前执行进度。

## 数据层（✅ 已完成 — PR #201）

### WorkflowGraph 类型

`WorkflowDefinition.moderator`（函数）已替换为 `WorkflowDefinition.table`（声明式 `ModeratorTable`），`buildDescriptor` 自动从 table 提取 graph：

```ts
type WorkflowGraphEdge = {
  from: string;              // source role 或 "__start__"
  to: string;                // target role 或 "__end__"
  condition: string;         // condition.name 或 "FALLBACK"
  conditionDescription: string | null;
};

type WorkflowGraph = {
  edges: readonly WorkflowGraphEdge[];
};

type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
  graph: WorkflowGraph;      // 必填，新 bundle 自动生成
};
```

### 数据流

```
ModeratorTable (WorkflowDefinition.table)
  → buildDescriptor() 自动提取 graph
    → descriptor.yaml 持久化（hash.yaml）
      → CLI serve /workflows/:name API 返回 descriptor
        → Dashboard 前端拿到 graph
```

### 剩余数据层工作

**serve API 需要返回 descriptor**：当前 `GET /workflows/:name` 只返回 registry entry（hash + timestamp），不含 descriptor。需要从 `bundles/{hash}.yaml` 读取 descriptor 并返回给前端。

方案：在 `routes-workflow.ts` 的 `GET /workflows/:name` 响应中附带 `descriptor` 字段。或者：thread-detail 发现 workflow name 后，请求 `GET /workflows/:name/descriptor` 拿到 graph。

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
WorkflowGraph.edges → React Flow nodes + edges

节点（自动从 edges 推导）:
  - __start__  → 圆形小节点（入口）
  - role       → 圆角矩形，显示 role name + description
  - __end__    → 圆形小节点（终止）

边:
  - FALLBACK   → 虚线（dashed），无 label
  - condition  → 实线，label = condition
                  hover tooltip = conditionDescription
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
dashboard/src/
  components/
    workflow-graph/
      types.ts           — NodeState 等前端类型
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

## 实施计划

### ~~Phase 0: 数据层~~ ✅ Done (PR #201)

- [x] `WorkflowDefinition.moderator` → `table` (ModeratorTable)
- [x] `WorkflowDescriptor` 新增 `graph: WorkflowGraph`
- [x] `buildDescriptor` 自动提取 graph
- [x] `validateWorkflowDescriptor` 校验 graph

### Phase 1: API + 静态图渲染

1. serve API：`GET /workflows/:name` 返回 descriptor（含 graph），或新增 `GET /workflows/:name/descriptor`
2. Dashboard `api.ts` 新增 `getWorkflowDescriptor(agent, name)` 函数
3. 安装 `@xyflow/react` + `@dagrejs/dagre`
4. 实现 `workflow-graph/` 组件集
5. ThreadDetail 中集成：从 thread-start record 拿 workflow name → 请求 descriptor → 渲染图

**产出**：打开 ThreadDetail 看到 workflow 流程图，无高亮。

### Phase 2: 运行时高亮

1. ThreadDetail 根据 records 计算 nodeStates
2. 节点/边样式响应状态变化
3. SSE live 模式下实时更新高亮

**产出**：正在运行的 thread 能看到当前执行到哪个 role。

### Phase 3: 交互增强

1. 点击节点滚动到对应 role 的 RecordCard
2. 边 hover 显示 conditionDescription tooltip
3. 节点 hover 显示 role description + schema summary

**产出**：图和记录列表联动。

## 注意事项

- **自循环边**：如 `coder → coder (FALLBACK)`，React Flow 支持自循环，dagre 需要特殊处理（self-edge 用 loop 路径）
- **大图性能**：dagre 在 <50 节点时性能无忧，workflow 通常 <10 个 role
- **暗色主题**：Dashboard 已使用 CSS variables，节点/边样式复用现有色板
- **不提交 pnpm-lock.yaml**
