/**
 * 空间地图二维布局算法
 * 基于父子层级 + 相邻关系，生成二维网格布局
 */

export interface SpatialNode {
  id: string;
  parentId?: string;
  name: string;
  variants?: unknown[];
}

export interface SpatialRelation {
  from: string;
  to: string;
  direction: string;
  bidirectionalView: boolean;
}

export interface NodePosition {
  x: number;
  y: number;
  depth: number;
  col: number;
  row: number;
}

export interface LayoutResult {
  positions: Map<string, NodePosition>;
  svgWidth: number;
  svgHeight: number;
  nodeWidth: number;
  nodeHeight: number;
}

/**
 * 计算空间地图的二维布局
 * 策略：按父子关系分层（纵向），同层节点按相邻关系分组后网格排列
 */
export function computeSpatialLayout(
  nodes: SpatialNode[],
  relations: SpatialRelation[],
  opts: { nodeWidth?: number; nodeHeight?: number; gapX?: number; gapY?: number; maxCols?: number } = {},
): LayoutResult {
  const NW = opts.nodeWidth || 130;
  const NH = opts.nodeHeight || 54;
  const GX = opts.gapX || 20;
  const GY = opts.gapY || 60;
  const MAX_COLS = opts.maxCols || 5;

  const nodeSet = new Set(nodes.map(n => n.id));

  // 构建父子关系
  const childrenMap = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    if (n.parentId && nodeSet.has(n.parentId)) {
      if (!childrenMap.has(n.parentId)) childrenMap.set(n.parentId, []);
      childrenMap.get(n.parentId)!.push(n.id);
    } else {
      roots.push(n.id);
    }
  }

  // 构建相邻关系图（用于同层排序）
  const adjMap = new Map<string, Set<string>>();
  for (const r of relations) {
    if (!nodeSet.has(r.from) || !nodeSet.has(r.to)) continue;
    if (!adjMap.has(r.from)) adjMap.set(r.from, new Set());
    if (!adjMap.has(r.to)) adjMap.set(r.to, new Set());
    adjMap.get(r.from)!.add(r.to);
    adjMap.get(r.to)!.add(r.from);
  }

  // BFS 分层：每个节点分配 depth
  const depthMap = new Map<string, number>();
  const layerNodes = new Map<number, string[]>(); // depth -> nodeIds

  const assignDepth = (id: string, depth: number) => {
    if (depthMap.has(id)) return;
    depthMap.set(id, depth);
    if (!layerNodes.has(depth)) layerNodes.set(depth, []);
    layerNodes.get(depth)!.push(id);
    const children = childrenMap.get(id) || [];
    for (const cid of children) assignDepth(cid, depth + 1);
  };
  for (const rid of roots) assignDepth(rid, 0);

  // 处理孤立节点（没有被分配 depth 的）
  for (const n of nodes) {
    if (!depthMap.has(n.id)) {
      const d = 0;
      depthMap.set(n.id, d);
      if (!layerNodes.has(d)) layerNodes.set(d, []);
      layerNodes.get(d)!.push(n.id);
    }
  }

  // 同层内按相邻关系排序（BFS 聚类，相邻的排在一起）
  const sortLayerByAdjacency = (ids: string[]): string[] => {
    if (ids.length <= 1) return ids;
    const inLayer = new Set(ids);
    const sorted: string[] = [];
    const visited = new Set<string>();

    // 从每个未访问节点开始 BFS，相邻的聚在一起
    for (const startId of ids) {
      if (visited.has(startId)) continue;
      const queue = [startId];
      visited.add(startId);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        sorted.push(cur);
        const neighbors = adjMap.get(cur) || new Set();
        for (const nb of neighbors) {
          if (inLayer.has(nb) && !visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }
    }
    return sorted;
  };

  // 计算每层排序后的节点，然后按网格排列
  const positions = new Map<string, NodePosition>();
  const maxDepth = Math.max(...Array.from(layerNodes.keys()), 0);

  for (let d = 0; d <= maxDepth; d++) {
    const ids = layerNodes.get(d) || [];
    const sorted = sortLayerByAdjacency(ids);
    // 网格排列：每行最多 MAX_COLS 个
    for (let i = 0; i < sorted.length; i++) {
      const col = i % MAX_COLS;
      const extraRow = Math.floor(i / MAX_COLS);
      positions.set(sorted[i], {
        x: col * (NW + GX),
        y: d * (NH + GY) * 2 + extraRow * (NH + GY), // depth 间距更大，同层换行间距小
        depth: d,
        col,
        row: extraRow,
      });
    }
  }

  // 计算 SVG 尺寸
  let maxX = 0, maxY = 0;
  positions.forEach(pos => {
    if (pos.x + NW > maxX) maxX = pos.x + NW;
    if (pos.y + NH > maxY) maxY = pos.y + NH;
  });

  return {
    positions,
    svgWidth: Math.max(maxX + 20, 300),
    svgHeight: Math.max(maxY + 40, 200),
    nodeWidth: NW,
    nodeHeight: NH,
  };
}
