import { Node, Edge } from '@xyflow/react';

const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 50;
const HORIZONTAL_GAP = 80; // 层与层之间的水平间距
const VERTICAL_GAP = 40; // 同层节点之间的垂直间距

/**
 * 获取节点的尺寸
 */
function getNodeSize(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
  };
}

/**
 * 构建邻接表（出边）和入度表
 */
function buildGraph(nodes: Node[], edges: Edge[]) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>(); // nodeId -> [targetIds]
  const incoming = new Map<string, string[]>(); // nodeId -> [sourceIds]
  const inDegree = new Map<string, number>();

  // 初始化
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  // 构建图
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      outgoing.get(edge.source)!.push(edge.target);
      incoming.get(edge.target)!.push(edge.source);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  return { outgoing, incoming, inDegree };
}

/**
 * 使用拓扑排序将节点分层
 * - 'start' 节点固定在第 0 层
 * - 'end' 节点固定在最后一层
 * - 孤立节点放在中间层
 */
function assignLayers(nodes: Node[], edges: Edge[]): Map<string, number> {
  const { outgoing, inDegree } = buildGraph(nodes, edges);
  const layers = new Map<string, number>();
  const queue: string[] = [];

  // 1. start 节点固定在第 0 层
  layers.set('start', 0);
  queue.push('start');

  // 2. BFS 分层（排除 end 节点，稍后单独处理）
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;

    for (const target of outgoing.get(current) ?? []) {
      // 跳过 end 节点，稍后处理
      if (target === 'end') continue;

      const newLayer = currentLayer + 1;
      const existingLayer = layers.get(target);

      if (existingLayer === undefined) {
        layers.set(target, newLayer);
        inDegree.set(target, (inDegree.get(target) ?? 1) - 1);
        if (inDegree.get(target) === 0) {
          queue.push(target);
        }
      } else {
        // 如果已有层级，取更大的值（确保所有前驱都在前面）
        layers.set(target, Math.max(existingLayer, newLayer));
      }
    }
  }

  // 3. 找到当前最大层级
  let maxLayer = 0;
  for (const layer of layers.values()) {
    maxLayer = Math.max(maxLayer, layer);
  }

  // 4. 处理孤立节点（没有被分配层级的非 start/end 节点）
  // 把它们放在中间层
  const middleLayer = Math.max(1, Math.floor((maxLayer + 1) / 2));
  for (const node of nodes) {
    if (node.id !== 'start' && node.id !== 'end' && !layers.has(node.id)) {
      layers.set(node.id, middleLayer);
    }
  }

  // 5. 重新计算最大层级（可能因为孤立节点而变化）
  maxLayer = 0;
  for (const [id, layer] of layers) {
    if (id !== 'end') {
      maxLayer = Math.max(maxLayer, layer);
    }
  }

  // 6. end 节点固定在最后一层
  layers.set('end', maxLayer + 1);

  return layers;
}

/**
 * 按层级分组节点
 */
function groupByLayer<N extends Node>(nodes: N[], layers: Map<string, number>): Map<number, N[]> {
  const groups = new Map<number, N[]>();

  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!groups.has(layer)) {
      groups.set(layer, []);
    }
    groups.get(layer)!.push(node);
  }

  return groups;
}

/**
 * 计算每层的最大宽度
 */
function calculateLayerWidths(layerGroups: Map<number, Node[]>): Map<number, number> {
  const widths = new Map<number, number>();

  for (const [layer, nodesInLayer] of layerGroups) {
    let maxWidth = 0;
    for (const node of nodesInLayer) {
      const { width } = getNodeSize(node);
      maxWidth = Math.max(maxWidth, width);
    }
    widths.set(layer, maxWidth);
  }

  return widths;
}

/**
 * 计算每层的 X 起始位置
 */
function calculateLayerXPositions(
  layerWidths: Map<number, number>,
  maxLayer: number
): Map<number, number> {
  const xPositions = new Map<number, number>();
  let currentX = 0;

  for (let layer = 0; layer <= maxLayer; layer++) {
    xPositions.set(layer, currentX);
    const layerWidth = layerWidths.get(layer) ?? DEFAULT_NODE_WIDTH;
    currentX += layerWidth + HORIZONTAL_GAP;
  }

  return xPositions;
}

/**
 * Todo: 1-N 情况下的布局优化
 * Todo: 如果计算完了之后，所有节点的位置都没变，则不更新节点，避免不必要的重渲染
 * node 中有 measured 属性，可以获得其尺寸，如果没有，则使用一个默认尺寸 120*50
 * edge 的 source 和 target 分别对应两端的 node 的 id
 *
 * 算法步骤：
 * 1. 使用拓扑排序将节点分层（从左到右）
 * 2. 计算每层的 X 位置
 * 3. 在每层内垂直居中排列节点
 */
export function LayoutLR<N extends Node>(nodes: N[], edges: Edge[]): N[] {
  if (nodes.length === 0) {
    return [];
  }

  // 1. 分配层级
  const layers = assignLayers(nodes, edges);

  // 2. 按层级分组
  const layerGroups = groupByLayer(nodes, layers);

  // 3. 计算每层宽度和 X 位置
  const maxLayer = Math.max(...layers.values());
  const layerWidths = calculateLayerWidths(layerGroups);
  const layerXPositions = calculateLayerXPositions(layerWidths, maxLayer);

  // 4. 计算每层的总高度，用于垂直居中
  const layerHeights = new Map<number, number>();
  for (const [layer, nodesInLayer] of layerGroups) {
    let totalHeight = 0;
    for (const node of nodesInLayer) {
      const { height } = getNodeSize(node);
      totalHeight += height;
    }
    totalHeight += (nodesInLayer.length - 1) * VERTICAL_GAP;
    layerHeights.set(layer, totalHeight);
  }

  // 找到最大高度，用于垂直居中对齐
  const maxHeight = Math.max(...layerHeights.values());

  // 5. 为每个节点分配位置，并检查是否有变化
  const layoutedNodes: N[] = [];
  let hasChanged = false;

  for (const [layer, nodesInLayer] of layerGroups) {
    const layerHeight = layerHeights.get(layer) ?? 0;
    const startY = (maxHeight - layerHeight) / 2; // 垂直居中
    const x = layerXPositions.get(layer) ?? 0;

    let currentY = startY;

    for (const node of nodesInLayer) {
      const { height } = getNodeSize(node);
      const newPosition = { x, y: currentY };
      if (node.position.x !== newPosition.x || node.position.y !== newPosition.y) {
        hasChanged = true;
        layoutedNodes.push({
          ...node,
          position: newPosition,
        });
      } else {
        layoutedNodes.push(node);
      }
      currentY += height + VERTICAL_GAP;
    }
  }

  return hasChanged ? layoutedNodes : nodes;
}
