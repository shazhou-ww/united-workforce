
# Workflow UI — 开发上下文文档

## 1. 项目定位

dashboard 是一个 Web 图形编辑器，用于可视化展示和编辑工作流（Workflow）的结构。

**核心场景**：
- 用户本地执行 `uwf connect` 命令，通过 WebSocket 连接到此 Web 服务
- CLI 将本地 YAML 工作流文件发送到 server
- Server 解析后，提供图形化界面展示工作流的节点拓扑，允许用户进行逻辑编排和节点编辑
- 编辑完成后，数据可回传给 CLI 或持久化

## 2. 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 图编辑器 | @xyflow/react v12 | 节点/边渲染、拖拽、连线（strict 连接模式） |
| 前端框架 | React 19 | UI 组件 |
| 路由 | react-router v7 | Hash 模式路由 |
| 状态管理 | 自研 (context.tsx) | 基于 useSyncExternalStore + Immer |
| 样式 | Tailwind CSS v4 | 原子化 CSS |
| 图标 | lucide-react | 图标库 |
| 构建工具 | Vite 8 | Dev server + 打包 |
| 后端框架 | Elysia | 轻量 REST API（当前为 stub） |

## 3. 目录结构

```
dashboard/
├── server.ts                 # Vite dev server 入口 (port 3000)
├── vite.config.ts            # Vite 配置（react + tailwind + elysia 插件 + @ 别名）
├── vite-dev.ts               # 自定义 Vite 插件
├── components.json           # shadcn 配置
├── server/
│   ├── api.ts                # Elysia REST API (health + workflow CRUD)
│   └── workflow.ts           # Workflow 文件读写 + 格式转换
├── tmp/workflow/             # Workflow YAML 存储目录（开发阶段）
├── src/
│   ├── main.tsx              # React DOM 入口
│   ├── router.tsx            # React Router 配置
│   ├── app.tsx               # 根布局组件
│   ├── lib/utils.ts          # Tailwind cn() 工具
│   ├── components/ui/        # shadcn 组件（button, card, dialog, input, textarea）
│   ├── pages/
│   │   ├── home.tsx          # Home 列表页（workflow 管理）
│   │   └── detail.tsx        # Workflow 详情/编辑页
│   └── editor/               # ★ 核心编辑器
│       ├── flow.tsx          # FlowEditor 组件 + 公开 API 导出
│       ├── type.ts           # 内部类型定义
│       ├── context.tsx       # 自研状态管理框架
│       ├── injection.ts      # DI 容器（FlowModel / Injection）
│       ├── model/            # 状态模型层
│       ├── nodes/            # 节点渲染组件
│       ├── edges/            # 边渲染组件
│       ├── panel/            # UI 面板（工具栏、添加/编辑面板）
│       ├── trans/            # 数据转换层（内外格式互转）
│       ├── layout/           # 自动布局算法
│       └── utils/            # 工具函数
```

## 4. 数据模型

### 4.1 外部格式 — WorkFlowSteps（与 CLI 交换的数据）

`WorkFlowSteps` 是 `WorkFlowStep[]`，每个 step 描述一个角色节点及其转移关系：

```typescript
type WorkFlowRole = {
  name: string;          // 角色名称（唯一标识）
  description: string;   // 角色描述
  identity: string;      // 身份定义（system prompt）
  prepare: string;       // 执行前准备指令
  execute: string;       // 核心执行指令
  report: string;        // 输出格式指令
};

type WorkFlowTransition = {
  target: string;           // 目标角色名 或 'END'
  condition: string | null; // 条件表达式，null 为 else（无条件兜底）
};

type WorkFlowStep = {
  role: WorkFlowRole;
  transitions: WorkFlowTransition[];
};
```

### 4.2 内部格式 — ReactFlow Nodes & Edges

编辑器内部使用 ReactFlow 的 Node/Edge 模型：

**节点类型**：
- `start` → 起始节点（右侧 1 个 source handle）
- `end` → 结束节点（左侧 1 个 target handle）
- `role` → 角色节点（6 个 handle，见下方）

**Role 节点 Handle 布局**：

| 位置 | 类型 | ID | 颜色 |
|------|------|----|------|
| 左侧 | target (in) | `input` | 蓝色 |
| 上方 30% | target (in) | `input-top` | 蓝色 |
| 下方 30% | target (in) | `input-bottom` | 蓝色 |
| 右侧 | source (out) | `output` | 绿色 |
| 上方 70% | source (out) | `output-top` | 绿色 |
| 下方 70% | source (out) | `output-bottom` | 绿色 |

- target handle 设置了 `isConnectableStart`，可以从 in 拖向 out 发起连线（`onConnect` 自动纠正方向）
- source handle 设置了 `isConnectableEnd`

**RoleNodeData** 对齐上游 `RoleDefinition`：
```typescript
type RoleNodeData = {
  name: string;
  description: string;
  identity: string;
  prepare: string;
  execute: string;
  report: string;
};
```

**边类型**：
- `default`（GradientEdge）→ 渐变色边（绿→蓝），节点仅有一条出边时使用
- `status`（StatusEdge）→ 带 status 标签的渐变色边，节点有多条出边时使用

**边渲染特性**：
- 渐变色：SVG linearGradient，从 source 端绿色（#10b981）到 target 端蓝色（#3b82f6）
- 选中时：变为琥珀色（#f59e0b）单色，方便识别
- 缺少条件时：红色（#ff5252）
- 交互区域：20px 宽透明路径用于点击

### 4.3 Else 分支机制

当一个节点有多条 conditional 出边时：
- **edges 数组中排第一个的 conditional 边自动成为 else**（兜底分支）
- else 边显示灰色 `else` badge（不可点击，无需设置条件）
- 其余边显示 `if` badge（需要设置条件，可点击编辑）
- 只有一条 conditional 出边时不显示 else 标签
- else 边在有 if 兄弟存在时不能被删除（`onBeforeDelete` 保护）
- 序列化时 else 边输出 `condition: null`
- 反序列化时 `condition: null` 的 transition 排序到第一个

### 4.4 条件边自动升级与降级

- **升级**：当用户从某节点拖出第二条边时，`edgesModel.onConnect` 自动将该节点所有出边升级为 `conditional` 类型。
- **降级**：当删除 conditional 边后，若该 source 仅剩一条 conditional 出边，`handlers.onDelete` 自动将其降级回 `default` 类型。

### 4.5 连线约束

`onConnect` 中的校验逻辑：
1. 禁止自连（source === target）
2. 禁止同一对节点之间的重复边（source+target 去重）
3. 方向归一化：从 input handle 拖到 output handle 时自动反转 source/target
4. Handle 类型校验：source 端必须是 output handle，target 端必须是 input handle

### 4.6 数据转换层（trans/）

```
WorkFlowSteps  ──transIn()──→  { nodes, edges }  ──transOut()──→  WorkFlowSteps
                 （反序列化）                           （序列化）
```

- `transIn(steps)`: 外部步骤列表 → ReactFlow 节点和边
- `transOut(nodes, edges)`: ReactFlow 节点和边 → 外部步骤列表
- `validate(nodes, edges)`: 校验图结构合法性

三个函数都是**纯函数**。

### 4.7 验证规则

1. start 恰好 1 个，输出恰好 1 条
2. end 恰好 1 个，输入 ≥1 条，输出 0 条
3. role 节点：输入 ≥1、输出 ≥1
4. 多输出时：第一条 conditional 边为 else（跳过 condition 检查），其余必须有非空 condition
5. role 节点总数 ≥2
6. 无孤立节点（正向 BFS 从 start 可达 + 反向 BFS 从 end 可达）

## 5. 架构分层

### 5.1 状态管理框架（context.tsx）

自研的轻量响应式系统，核心概念：

| 概念 | 说明 |
|------|------|
| `generate<T>()` | 创建响应式 store（get/set/use/listen） |
| `SubModel<T, A>` | 状态切片模板（name + make() + create()） |
| `Model` | 事务管理器 + undo/redo 栈 |
| `define.model()` | 定义有状态有 actions 的模型 |
| `define.view()` | 定义只读视图模型 |
| `define.memoize()` | 定义缓存计算模型 |
| `define.compute()` | 定义响应式依赖计算（自动追踪） |

使用 `useSyncExternalStore` 桥接 React 渲染。

### 5.2 模型层（model/）

| 模型 | 文件 | 职责 |
|------|------|------|
| `nodesModel` | nodes.ts | 节点数组状态 + CRUD 操作 |
| `edgesModel` | edges.ts | 边数组状态 + 连线 + conditional 自动升级 + 连线约束 |
| `addNodeViewModel` | add-node-view.ts | 添加节点面板的 UI 状态 |
| `editNodeViewModel` | edit-node-view.ts | 编辑节点面板的 UI 状态 |
| `injection` | inject.ts | DI 实例视图模型 |
| `handlers` | handlers.ts | 事件处理器集合（拖拽、连线、删除保护、快捷键、布局、加载/保存） |

### 5.3 DI 容器（injection.ts）

```
FlowModel（公开 API）          Injection（内部实现）
  ├─ load(steps)  ──emit──→     emit('load', steps)  → handlers.loadSteps()
  ├─ on('save', cb)              emit('save', steps)  ← handlers.saveData()
  └─ 持有 Injection 实例
```

- `FlowModel` 是外部消费者唯一接触的类，提供 `load()` 和 `on('save')` 接口
- 构造函数接受可选的 `inital_steps` 参数，用于加载默认工作流
- `Injection` 是内部事件总线，解耦 server 通信与 UI 状态

### 5.4 事务与 Undo/Redo

Model 提供事务机制：
- `startTransaction()` 快照当前状态
- `endTransaction()` 将快照推入 undo 栈
- Ctrl+Z / Ctrl+Y 触发撤销/重做
- 拖拽、添加节点、删除等操作自动包裹在事务中

## 6. 节点体系

### 6.1 渲染组件

```
ReactFlow
  ├─ nodeTypes: { start: NodeStart, end: NodeEnd, role: NodeRole }
  └─ edgeTypes: { default: GradientEdge, status: StatusEdge }
```

`NodeRole` 显示角色名（data.name），使用 teal 色系图标和标签。Handle 分蓝色（in）和绿色（out）两种颜色。

### 6.2 节点编辑

角色节点的编辑器直接内联在 AddNodePanel 和 EditNodePanel 中，可编辑字段：
- name（必填）
- description、identity、prepare、execute、report（textarea）

## 7. UI 面板

| 面板 | 位置 | 内容 |
|------|------|------|
| Toolbar | 顶部居中 | Undo/Redo、添加角色、自动布局、保存 |
| AddNodePanel | 右下角 | 角色节点创建表单（name + 6 字段 → 确认） |
| EditNodePanel | 右下角 | 角色节点编辑表单（预填当前数据 → 确认） |

AddNodePanel 和 EditNodePanel 互斥显示，点击外部自动关闭。

## 8. 自动布局（layout/）

`LayoutLR(nodes, edges)` 算法：
1. 拓扑排序分层（BFS，start → layer 0，end → max+1）
2. 按层分组
3. 计算 X/Y 坐标（水平间距 80px，垂直间距 40px）
4. 无变化时返回原数组（避免无效重渲染）

## 9. 核心数据流

### 加载工作流

```
FlowModel.load(steps) / FlowModel(initialSteps)
  → Injection.emit('load', steps)
  → handlers.loadSteps()
  → transIn(steps) → { nodes, edges }
    （condition: null 的 transition 排序到第一个，成为 else）
  → nodesModel.set(nodes)
  → edgesModel.set(edges)
  → autoLayoutLR()
  → model.reset()（清空 undo/redo）
```

### 保存工作流

```
用户点击 Save
  → handlers.saveData()
  → validate(nodes, edges)
  → 校验失败 → Toast 提示错误
  → 校验通过 → transOut(nodes, edges) → WorkFlowSteps
    （第一条 conditional 边序列化为 condition: null）
  → Injection.emit('save', steps)
  → FlowModel.emit('save', steps)
  → 外部消费者（server/CLI）接收
```

### 连线与条件边升级

```
用户拖线连接两个节点
  → edgesModel.onConnect(params)
  → normalizeConnection（方向纠正）
  → 校验（自连、重复、handle 类型）
  → 检查 source 已有出边数量
  → 已有出边 → 新边 + 已有边全部升级为 conditional
  → 首条出边 → 创建普通边
```

### 删除保护

```
用户选中节点/边按 Delete
  → handlers.onBeforeDelete({ nodes, edges })
  → start/end 节点 → 阻止
  → else 边（有 if 兄弟时）→ 阻止
  → 其他 → 允许
```

## 10. 上游数据模型参考

dashboard 消费的 YAML 工作流最终映射自 `WorkflowPayload`（定义在 protocol）：

```typescript
type WorkflowPayload = {
  name: string;
  description: string;
  roles: Record<string, RoleDefinition>;       // 角色定义（4 段式：identity/prepare/execute/report）
  graph: Record<string, Record<string, Target>>;   // status-based 路由图
};
```

dashboard 使用 `WorkFlowSteps` 格式作为交换数据，其中 `WorkFlowRole` 的字段与 `RoleDefinition` 对齐（description/identity/prepare/execute/report），`WorkFlowTransition` 对应 graph 中的 `Target`。外部（CLI/server）负责 `WorkflowPayload` ↔ `WorkFlowSteps` 的转换。

## 11. 当前状态与待完善项

- **WebSocket 集成**: 尚未实现，CLI connect 的 WebSocket 通信待开发
- **验证**: 图结构校验 + 可达性检测 + else 分支规则已实现
- **只读模式**: Detail 页面有"编辑/预览"切换按钮，但编辑器尚未实现真正的只读模式（禁止交互）

## 12. 业务系统

### 12.1 路由

| 路由 | 页面 | 文件 |
|------|------|------|
| `/` | Home — Workflow 列表 | `src/pages/home.tsx` |
| `/workflow/:name` | Detail — 预览/编辑 | `src/pages/detail.tsx` |

### 12.2 后端 API

Elysia REST API（`server/api.ts`），通过 Vite 插件（`vite-dev.ts`）集成到 dev server。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/workflows` | 列出所有 workflow（name + description） |
| GET | `/api/workflows/:name` | 获取单个 workflow（返回 WorkFlowSteps JSON） |
| POST | `/api/workflows` | 新建 workflow（body: `{name, description}`） |
| PUT | `/api/workflows/:name` | 保存 workflow（body: WorkFlowSteps JSON） |
| DELETE | `/api/workflows/:name` | 删除 workflow |

### 12.3 数据存储

- 存储目录：`tmp/workflow/`，文件名 `{name}.yaml`
- 存储格式：WorkflowPayload YAML（与上游 protocol 一致）
- Server 端负责 WorkflowPayload ↔ WorkFlowSteps 转换（`server/workflow.ts`）

字段映射：
| WorkFlowRole | RoleDefinition |
|--------------|---------------|
| name | roles map key |
| description | description |
| identity | goal |
| prepare | capabilities (join/split by `\n`) |
| execute | procedure |
| report | output |

条件映射：WorkFlowTransition.condition 存储表达式字符串，保存时提取为 named conditions map。

### 12.4 shadcn/ui

已初始化 shadcn（`components.json`），使用 `@` 路径别名。已安装组件：
- button、card、dialog、input、textarea
- 组件位于 `src/components/ui/`

### 12.5 目录结构更新

```
dashboard/
├── server/
│   ├── api.ts                # Elysia REST API（health + workflow CRUD）
│   └── workflow.ts           # Workflow 文件读写 + 格式转换
├── src/
│   ├── components/ui/        # shadcn 组件
│   ├── pages/
│   │   ├── home.tsx          # Home 列表页
│   │   └── detail.tsx        # Workflow 详情/编辑页
│   └── ...
├── tmp/workflow/             # Workflow YAML 存储目录（开发阶段）
└── components.json           # shadcn 配置
```
