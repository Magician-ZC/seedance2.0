/**
 * EntityGraph - 轻量内存知识图谱
 * 用于小说实体的增量提取、去重和关系管理
 *
 * 节点类型: character（角色）、location（场景）
 * 边类型: co_appear（同现）、spatial（空间关系）、social（社交关系）
 */

// ====== 类型定义 ======

export type NodeType = 'character' | 'location';

export type EdgeType =
  | 'co_appear'      // 角色-角色 同一章节出现
  | 'appears_at'     // 角色-场景 角色出现在某场景
  | 'spatial_parent'  // 场景-场景 父子关系（教室→教学楼）
  | 'spatial_adjacent' // 场景-场景 相邻关系
  | 'social';         // 角色-角色 社交关系（同学、师生等）

export interface GraphNode {
  id: string;           // 内部 ID（自动生成）
  type: NodeType;
  name: string;         // 主名称
  aliases: Set<string>; // 所有别名
  attrs: Record<string, unknown>; // 属性（description, role, personality 等）
  chapters: Set<number>; // 出现的章节
}

export interface GraphEdge {
  from: string;   // 节点 ID
  to: string;     // 节点 ID
  type: EdgeType;
  attrs: Record<string, unknown>; // direction, visibleFrom 等
  chapters: Set<number>; // 关系出现的章节
}

// ====== EntityGraph 类 ======

export class EntityGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private nameIndex = new Map<string, string>(); // name/alias → nodeId（小写）
  private nextCharId = 1;
  private nextLocId = 1;

  // 查找节点：按名字或别名匹配
  findNode(name: string, type: NodeType): GraphNode | undefined {
    const key = `${type}:${name.toLowerCase().trim()}`;
    const id = this.nameIndex.get(key);
    return id ? this.nodes.get(id) : undefined;
  }

  // 模糊查找：检查名字是否是某个已有节点的子串或别名
  private fuzzyFindNode(name: string, type: NodeType): GraphNode | undefined {
    // 精确匹配
    const exact = this.findNode(name, type);
    if (exact) return exact;

    const nameLower = name.toLowerCase().trim();
    if (nameLower.length < 2) return undefined;

    // 遍历同类型节点，检查别名包含关系
    for (const node of this.nodes.values()) {
      if (node.type !== type) continue;
      // 检查已有名字是否包含新名字，或新名字包含已有名字
      const mainLower = node.name.toLowerCase();
      if (mainLower.includes(nameLower) || nameLower.includes(mainLower)) {
        return node;
      }
      for (const alias of node.aliases) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower.includes(nameLower) || nameLower.includes(aliasLower)) {
          return node;
        }
      }
    }
    return undefined;
  }

  // 注册名字到索引
  private indexName(name: string, type: NodeType, nodeId: string): void {
    const key = `${type}:${name.toLowerCase().trim()}`;
    if (!this.nameIndex.has(key)) {
      this.nameIndex.set(key, nodeId);
    }
  }

  // Upsert 角色节点
  upsertCharacter(data: {
    name: string;
    aliases?: string[];
    role?: string;
    description?: string;
    personality?: string;
  }, chapter: number): GraphNode {
    const existing = this.fuzzyFindNode(data.name, 'character');
    if (existing) {
      // 更新已有节点
      if (data.aliases) {
        for (const a of data.aliases) {
          existing.aliases.add(a);
          this.indexName(a, 'character', existing.id);
        }
      }
      existing.aliases.add(data.name);
      this.indexName(data.name, 'character', existing.id);
      existing.chapters.add(chapter);
      // 保留更详细的属性
      const attrs = existing.attrs;
      if (data.description && (data.description.length > ((attrs.description as string) || '').length)) {
        attrs.description = data.description;
      }
      if (data.personality && (data.personality.length > ((attrs.personality as string) || '').length)) {
        attrs.personality = data.personality;
      }
      // 升级角色重要性
      const roleRank: Record<string, number> = { protagonist: 3, supporting: 2, minor: 1 };
      if (data.role && (roleRank[data.role] || 0) > (roleRank[attrs.role as string] || 0)) {
        attrs.role = data.role;
      }
      return existing;
    }

    // 创建新节点
    const id = `char_${this.nextCharId++}`;
    const node: GraphNode = {
      id,
      type: 'character',
      name: data.name,
      aliases: new Set(data.aliases || []),
      attrs: {
        role: data.role || 'minor',
        description: data.description || '',
        personality: data.personality || '',
      },
      chapters: new Set([chapter]),
    };
    this.nodes.set(id, node);
    this.indexName(data.name, 'character', id);
    for (const a of node.aliases) {
      this.indexName(a, 'character', id);
    }
    return node;
  }

  // Upsert 场景节点
  upsertLocation(data: {
    name: string;
    aliases?: string[];
    description?: string;
    spatialRelation?: string;
    parentName?: string;
    adjacentLocations?: Array<{ name: string; direction: string; visibleFrom: boolean }>;
  }, chapter: number): GraphNode {
    const existing = this.fuzzyFindNode(data.name, 'location');
    if (existing) {
      if (data.aliases) {
        for (const a of data.aliases) {
          existing.aliases.add(a);
          this.indexName(a, 'location', existing.id);
        }
      }
      existing.aliases.add(data.name);
      this.indexName(data.name, 'location', existing.id);
      existing.chapters.add(chapter);
      const attrs = existing.attrs;
      if (data.description && (data.description.length > ((attrs.description as string) || '').length)) {
        attrs.description = data.description;
      }
      if (data.spatialRelation && (data.spatialRelation.length > ((attrs.spatialRelation as string) || '').length)) {
        attrs.spatialRelation = data.spatialRelation;
      }
      if (data.parentName && !attrs.parentName) {
        attrs.parentName = data.parentName;
      }
      return existing;
    }

    const id = `loc_${this.nextLocId++}`;
    const node: GraphNode = {
      id,
      type: 'location',
      name: data.name,
      aliases: new Set(data.aliases || []),
      attrs: {
        description: data.description || '',
        spatialRelation: data.spatialRelation || '',
        parentName: data.parentName || '',
      },
      chapters: new Set([chapter]),
    };
    this.nodes.set(id, node);
    this.indexName(data.name, 'location', id);
    for (const a of node.aliases) {
      this.indexName(a, 'location', id);
    }
    return node;
  }


  // 添加边（自动去重）
  addEdge(fromId: string, toId: string, type: EdgeType, chapter: number, attrs: Record<string, unknown> = {}): void {
    if (fromId === toId) return;
    // 查找已有边
    const existing = this.edges.find(e =>
      e.type === type &&
      ((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))
    );
    if (existing) {
      existing.chapters.add(chapter);
      // 合并属性
      for (const [k, v] of Object.entries(attrs)) {
        if (v && !existing.attrs[k]) existing.attrs[k] = v;
      }
      return;
    }
    this.edges.push({ from: fromId, to: toId, type, attrs, chapters: new Set([chapter]) });
  }

  // 从一章的提取结果中批量 upsert
  ingestChapter(chapterNumber: number, data: Record<string, unknown>): void {
    const chars = (data.characters || []) as Array<Record<string, unknown>>;
    const locs = (data.locations || []) as Array<Record<string, unknown>>;
    const charNodes: GraphNode[] = [];
    const locNodes: GraphNode[] = [];

    // Upsert 角色
    for (const c of chars) {
      const name = (c.name as string) || '';
      if (!name) continue;
      const node = this.upsertCharacter({
        name,
        aliases: (c.aliases as string[]) || [],
        role: (c.role as string) || 'minor',
        description: (c.description as string) || '',
        personality: (c.personality as string) || '',
      }, chapterNumber);
      charNodes.push(node);
    }

    // Upsert 场景
    for (const l of locs) {
      const name = (l.name as string) || '';
      if (!name) continue;
      const node = this.upsertLocation({
        name,
        aliases: (l.aliases as string[]) || [],
        description: (l.description as string) || '',
        spatialRelation: (l.spatialRelation as string) || '',
        parentName: (l.parentName as string) || '',
        adjacentLocations: (l.adjacentLocations as Array<{ name: string; direction: string; visibleFrom: boolean }>) || [],
      }, chapterNumber);
      locNodes.push(node);
    }

    // 建立关系边

    // 1. 角色同现关系（同一章出现的角色之间）
    for (let i = 0; i < charNodes.length; i++) {
      for (let j = i + 1; j < charNodes.length; j++) {
        this.addEdge(charNodes[i].id, charNodes[j].id, 'co_appear', chapterNumber);
      }
    }

    // 2. 角色-场景出现关系
    for (const cn of charNodes) {
      for (const ln of locNodes) {
        this.addEdge(cn.id, ln.id, 'appears_at', chapterNumber);
      }
    }

    // 3. 场景空间关系（父子 + 相邻）
    for (const l of locs) {
      const name = (l.name as string) || '';
      const locNode = this.fuzzyFindNode(name, 'location');
      if (!locNode) continue;

      // 父子关系
      const parentName = (l.parentName as string) || '';
      if (parentName) {
        const parentNode = this.fuzzyFindNode(parentName, 'location');
        if (parentNode) {
          this.addEdge(locNode.id, parentNode.id, 'spatial_parent', chapterNumber);
        }
      }

      // 相邻关系
      const adjList = (l.adjacentLocations as Array<Record<string, unknown>>) || [];
      for (const adj of adjList) {
        const adjName = (adj.name as string) || '';
        if (!adjName) continue;
        const adjNode = this.fuzzyFindNode(adjName, 'location');
        if (adjNode) {
          this.addEdge(locNode.id, adjNode.id, 'spatial_adjacent', chapterNumber, {
            direction: (adj.direction as string) || '',
            visibleFrom: (adj.visibleFrom as boolean) ?? true,
          });
        }
      }
    }

    // 追加情节点和摘要到图的元数据
    const plots = (data.plotPoints || []) as Array<Record<string, unknown>>;
    for (const p of plots) {
      this._plotPoints.push({
        chapter: chapterNumber,
        summary: (p.summary as string) || '',
        emotionalTone: (p.emotionalTone as string) || '',
        keyEvents: (p.keyEvents as string[]) || [],
      });
    }
    if (data.chapterSummary) {
      this._summaries.push(`第${chapterNumber}章: ${data.chapterSummary}`);
    }
  }

  // 元数据存储
  private _plotPoints: Array<{ chapter: number; summary: string; emotionalTone: string; keyEvents: string[] }> = [];
  private _summaries: string[] = [];

  get plotPoints() { return this._plotPoints; }
  get summaries() { return this._summaries; }

  // ====== 导出方法 ======

  // 获取所有角色节点
  getCharacters(): GraphNode[] {
    return [...this.nodes.values()].filter(n => n.type === 'character');
  }

  // 获取所有场景节点
  getLocations(): GraphNode[] {
    return [...this.nodes.values()].filter(n => n.type === 'location');
  }

  // 获取节点的所有边
  getEdges(nodeId: string, type?: EdgeType): GraphEdge[] {
    return this.edges.filter(e =>
      (e.from === nodeId || e.to === nodeId) && (!type || e.type === type)
    );
  }

  // 获取所有指定类型的边
  getEdgesByType(type: EdgeType): GraphEdge[] {
    return this.edges.filter(e => e.type === type);
  }

  // 导出角色列表（用于精炼）
  exportCharactersForRefine(): Array<Record<string, unknown>> {
    return this.getCharacters().map(n => ({
      name: n.name,
      aliases: [...n.aliases].filter(a => a !== n.name),
      role: n.attrs.role || 'minor',
      description: n.attrs.description || '',
      personality: n.attrs.personality || '',
      chapters: [...n.chapters].sort((a, b) => a - b),
    }));
  }

  // 导出场景列表（用于精炼），包含从图边推导的空间关系
  exportLocationsForRefine(): Array<Record<string, unknown>> {
    return this.getLocations().map(n => {
      // 从边推导 parentName
      const parentEdge = this.edges.find(e => e.from === n.id && e.type === 'spatial_parent');
      const parentNode = parentEdge ? this.nodes.get(parentEdge.to) : undefined;

      // 从边推导 adjacentLocations
      const adjEdges = this.edges.filter(e =>
        e.type === 'spatial_adjacent' && (e.from === n.id || e.to === n.id)
      );
      const adjacentLocations = adjEdges.map(e => {
        const otherId = e.from === n.id ? e.to : e.from;
        const otherNode = this.nodes.get(otherId);
        return {
          name: otherNode?.name || '',
          direction: (e.attrs.direction as string) || '',
          visibleFrom: (e.attrs.visibleFrom as boolean) ?? true,
        };
      }).filter(a => a.name);

      return {
        name: n.name,
        aliases: [...n.aliases].filter(a => a !== n.name),
        description: n.attrs.description || '',
        spatialRelation: n.attrs.spatialRelation || '',
        parentName: parentNode?.name || (n.attrs.parentName as string) || '',
        adjacentLocations,
        chapters: [...n.chapters].sort((a, b) => a - b),
      };
    });
  }

  // 统计信息
  stats(): { characters: number; locations: number; edges: number } {
    return {
      characters: this.getCharacters().length,
      locations: this.getLocations().length,
      edges: this.edges.length,
    };
  }

  // ====== 序列化/反序列化（持久化到 DB） ======

  serialize(): string {
    const data = {
      nodes: [...this.nodes.entries()].map(([id, n]) => ({
        id, type: n.type, name: n.name,
        aliases: [...n.aliases],
        attrs: n.attrs,
        chapters: [...n.chapters],
      })),
      edges: this.edges.map(e => ({
        from: e.from, to: e.to, type: e.type,
        attrs: e.attrs, chapters: [...e.chapters],
      })),
      nextCharId: this.nextCharId,
      nextLocId: this.nextLocId,
      plotPoints: this._plotPoints,
      summaries: this._summaries,
    };
    return JSON.stringify(data);
  }

  static deserialize(json: string): EntityGraph {
    const g = new EntityGraph();
    try {
      const data = JSON.parse(json);
      g.nextCharId = data.nextCharId || 1;
      g.nextLocId = data.nextLocId || 1;
      g._plotPoints = data.plotPoints || [];
      g._summaries = data.summaries || [];

      for (const n of (data.nodes || [])) {
        const node: GraphNode = {
          id: n.id, type: n.type, name: n.name,
          aliases: new Set(n.aliases || []),
          attrs: n.attrs || {},
          chapters: new Set(n.chapters || []),
        };
        g.nodes.set(n.id, node);
        g.indexName(n.name, n.type, n.id);
        for (const a of node.aliases) {
          g.indexName(a, n.type, n.id);
        }
      }

      for (const e of (data.edges || [])) {
        g.edges.push({
          from: e.from, to: e.to, type: e.type,
          attrs: e.attrs || {},
          chapters: new Set(e.chapters || []),
        });
      }
    } catch (err) {
      console.error('[EntityGraph] deserialize failed:', err);
    }
    return g;
  }

  // ====== 名字映射（版权改造后更新） ======

  /** 批量重命名节点（版权改造后调用） */
  renameNodes(mapping: Array<{ originalName: string; newName: string; type: NodeType }>): void {
    for (const { originalName, newName, type } of mapping) {
      const node = this.fuzzyFindNode(originalName, type);
      if (!node) continue;
      // 旧名字保留为别名
      node.aliases.add(node.name);
      node.name = newName;
      // 新名字加入索引
      this.indexName(newName, type, node.id);
    }
  }

  // ====== 上下文导出（供 LLM prompt 使用） ======

  /** 导出角色关系上下文（用于脚本生成/优化） */
  buildRelationContext(): string {
    const lines: string[] = [];
    // 社交关系
    const socialEdges = this.getEdgesByType('social');
    if (socialEdges.length > 0) {
      lines.push('角色关系：');
      for (const e of socialEdges) {
        const from = this.nodes.get(e.from);
        const to = this.nodes.get(e.to);
        if (from && to) {
          const rel = (e.attrs.relation as string) || '关联';
          lines.push(`- ${from.name} ↔ ${to.name}: ${rel}`);
        }
      }
    }
    // 高频同现关系（出现在3章以上的）
    const coAppearEdges = this.getEdgesByType('co_appear').filter(e => e.chapters.size >= 3);
    if (coAppearEdges.length > 0) {
      lines.push('高频同现角色组：');
      for (const e of coAppearEdges) {
        const from = this.nodes.get(e.from);
        const to = this.nodes.get(e.to);
        if (from && to) {
          lines.push(`- ${from.name} & ${to.name} (${e.chapters.size}章同现)`);
        }
      }
    }
    // 角色-场景关联
    const appearsAtEdges = this.getEdgesByType('appears_at');
    if (appearsAtEdges.length > 0) {
      // 按角色分组
      const charLocMap = new Map<string, string[]>();
      for (const e of appearsAtEdges) {
        const charNode = this.nodes.get(e.from);
        const locNode = this.nodes.get(e.to);
        if (!charNode || !locNode) continue;
        if (charNode.type !== 'character') continue;
        if (!charLocMap.has(charNode.name)) charLocMap.set(charNode.name, []);
        const locs = charLocMap.get(charNode.name)!;
        if (!locs.includes(locNode.name)) locs.push(locNode.name);
      }
      lines.push('角色活动场景：');
      for (const [char, locs] of charLocMap) {
        lines.push(`- ${char}: ${locs.join('、')}`);
      }
    }
    return lines.join('\n');
  }

  /** 删除节点及其所有关联边 */
  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    // 删除索引
    const keysToRemove: string[] = [];
    for (const [key, id] of this.nameIndex) {
      if (id === nodeId) keysToRemove.push(key);
    }
    for (const k of keysToRemove) this.nameIndex.delete(k);
    // 删除关联边
    this.edges = this.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    // 删除节点
    this.nodes.delete(nodeId);
  }
}
