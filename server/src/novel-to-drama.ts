// 小说转短剧服务 - LLM 直接调用版
// 工作流：小说拆解 → 版权改造 → 角色图生成 → 剧本压缩
// 后端直接调用 LLM，前端无需手动复制 prompt

import { chatCompletionJSON, getLLMConfig, type LLMConfig } from './llm-service.js';
import { EntityGraph } from './entity-graph.js';
import {
  insertProject, getProjectById, updateProjectFields, listAllProjects, deleteProject,
  logLLMCall, getProjectLogs, insertCharacterAgent, type DramaProjectRow,
} from './db-service.js';

// ============================================================
// 类型定义
// ============================================================

export interface NovelAnalysis {
  title: string;
  originalTitle: string;
  summary: string;
  characters: CharacterInfo[];
  locations: LocationInfo[];
  spatialMap?: SpatialMap;
  plotPoints: PlotPoint[];
  themes: string[];
  totalChapters: number;
}

export interface CharacterInfo {
  id: string;
  originalName: string;
  newName: string;
  role: 'protagonist' | 'supporting' | 'minor';
  description: string;
  personality: string;
  visualPrompt: string;
  costumeDesc?: string; // 默认服化道描述（服装、妆容、标志性道具）
  imageUrls: string[];  // 旧版兼容：所有候选图
  confirmed: boolean;
  refImageUrl?: string; // 用户上传的参考图
  // 角色档案图片系统
  profileImages?: {
    main?: string;       // 主图（AI评分最佳的全身照）
    front?: string;      // 正面
    side?: string;       // 侧面
    back?: string;       // 背面
    costume?: string;    // 服装细节
    props?: string;      // 道具细节
    expressions?: string; // 表情特写
    custom?: Array<{ label: string; url: string }>; // 自定义角度/动作
  };
  profileStatus?: 'idle' | 'main_generating' | 'main_scoring' | 'detail_generating' | 'done'; // 档案生成状态
}

export interface LocationInfo {
  id: string;
  originalName: string;
  newName: string;
  description: string;
  visualPrompt: string;
  baseDescription?: string;    // 固定物理属性（空间布局、家具、建筑风格、光线方向等），不随镜头变化
  baseVisualPrompt?: string;   // 基准生图 prompt（只描述空场景，不含人物和活动），用于保证跨集一致性
  spatialRelation?: string;    // 空间关系描述（在哪栋楼、几楼、相邻什么）
  parentId?: string;           // 父级场景 ID（如教室的 parentId 是教学楼）
  adjacentLocations?: Array<{ id: string; direction: string; visibleFrom: boolean }>;  // 相邻场景及双向可见性
  variants?: Array<{ label: string; description: string }>;  // 状态变体（如"日常课堂"、"考试状态"、"空教室"），共享同一基准图
  imageUrl?: string;           // 确认后的单张图（基准图，所有变体共享）
  imageUrls?: string[];        // 候选图列表（即梦返回4张）
}

// 空间结构地图（整体层面描述所有地点的层级和空间关系）
export interface SpatialMap {
  tree: string;                // 文本形式的空间层级树
  relations: Array<{ from: string; to: string; direction: string; bidirectionalView: boolean }>;  // 双向可见关系
}

export interface PlotPoint {
  chapter: number;
  summary: string;
  emotionalTone: string;
  keyEvents: string[];
}

// 分镜（Shot）：每集由多个分镜组成，每个分镜最长 15 秒
export interface Shot {
  index: number;           // 分镜序号（从1开始）
  startTime: number;       // 起始秒数
  endTime: number;         // 结束秒数
  prompt: string;          // 该分镜的视频生成 prompt（完整版，含所有信息）
  dialogue?: string;       // 对白/旁白文本（独立字段，方便字幕和配音）
  action?: string;         // 动作描述（角色在做什么）
  cameraAngle?: string;    // 景别+运镜（如"近景，推镜头"）
  soundDesign?: string;    // 声音设计（配乐+音效）
  characterRefs: string[]; // 出场角色 ID
  locationRefs: string[];  // 场景 ID
  transition?: string;     // 与下一分镜的转场方式
  refImageUrls?: string[]; // 该分镜的参考图
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
}

export interface EpisodeScript {
  number: number;
  title: string;
  act: string;
  emotionalTone: string;
  prompt: string;          // 整集概述 prompt（保留兼容）
  shots: Shot[];            // 分镜列表
  characterRefs: string[];
  locationRefs: string[];
  endingFrame: string;
  refImageUrls?: string[];
  videoUrl?: string;       // 拼接后的完整视频（或最后一个分镜的视频）
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
  score?: number;
}

export interface DramaProject {
  id: string;
  novel: NovelAnalysis;
  targetEpisodes: number;
  style: string;
  ratio: string;
  episodeDuration: number;
  status: string;
  episodes: EpisodeScript[];
  createdAt: number;
  updatedAt?: number;
  entityGraphData?: string; // EntityGraph 序列化数据（贯穿整个创作流程）
}

// ============================================================
// DB ↔ DramaProject 转换
// ============================================================

function rowToProject(row: DramaProjectRow): DramaProject {
  const novelData = JSON.parse(row.novel_data || '{}');
  // entityGraphData 可能存在 novel_data JSON 内部（避免改 DB schema）
  const entityGraphData = novelData._entityGraphData;
  if (entityGraphData) delete novelData._entityGraphData;
  return {
    id: row.id,
    novel: novelData,
    targetEpisodes: row.target_episodes,
    style: row.style,
    ratio: row.ratio,
    episodeDuration: row.episode_duration,
    status: row.status,
    episodes: JSON.parse(row.episodes_data || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entityGraphData,
  };
}

function projectToRow(p: DramaProject): DramaProjectRow {
  // 将 entityGraphData 嵌入 novel_data JSON 中（避免改 DB schema）
  const novelForStorage = p.entityGraphData
    ? { ...p.novel, _entityGraphData: p.entityGraphData }
    : p.novel;
  return {
    id: p.id,
    title: p.novel?.title || '',
    status: p.status,
    target_episodes: p.targetEpisodes,
    style: p.style,
    ratio: p.ratio,
    episode_duration: p.episodeDuration,
    novel_data: JSON.stringify(novelForStorage),
    episodes_data: JSON.stringify(p.episodes),
    created_at: p.createdAt,
    updated_at: Date.now(),
  };
}

// ============================================================
// 文件名安全化 & 图片目录辅助
// ============================================================

// 将中文/特殊字符转为安全的文件夹名
function safeDirName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').substring(0, 60) || 'unnamed';
}

// 构建项目图片子目录路径（用项目名称 + 角色/场景名分子文件夹）
export function getProjectImageSubDir(project: DramaProject, category: 'characters' | 'locations' | 'refs', entityName?: string): string {
  const projectDir = safeDirName(project.novel.title || project.id);
  if (entityName) {
    return `${projectDir}/${category}/${safeDirName(entityName)}`;
  }
  return `${projectDir}/${category}`;
}

// ============================================================
// 项目 CRUD（封装 DB 操作）
// ============================================================

export function createProject(id: string, targetEpisodes: number, style: string, ratio: string, episodeDuration: number): DramaProject {
  const project: DramaProject = {
    id,
    novel: { title: '', originalTitle: '', summary: '', characters: [], locations: [], plotPoints: [], themes: [], totalChapters: 0 },
    targetEpisodes, style, ratio, episodeDuration,
    status: 'analyzing',
    episodes: [],
    createdAt: Date.now(),
  };
  insertProject(projectToRow(project));
  return project;
}

export function getProject(id: string): DramaProject | undefined {
  const row = getProjectById(id);
  return row ? rowToProject(row) : undefined;
}

export function updateProject(id: string, updates: Partial<DramaProject>): DramaProject | undefined {
  const project = getProject(id);
  if (!project) return undefined;
  Object.assign(project, updates);
  const row = projectToRow(project);
  updateProjectFields(id, {
    title: row.title, status: row.status, novel_data: row.novel_data,
    episodes_data: row.episodes_data, target_episodes: row.target_episodes,
    style: row.style, ratio: row.ratio, episode_duration: row.episode_duration,
  });
  return project;
}

export function listProjects(): DramaProject[] {
  return listAllProjects().map(rowToProject);
}

export function removeProject(id: string): void {
  deleteProject(id);
}

export { getProjectLogs };

// ============================================================
// LLM 驱动的核心流程
// ============================================================

// ============================================================
// 文本处理工具函数
// ============================================================

// 估算文本 token 数（中文 ≈ 1.5 token/字，英文 ≈ 0.75 token/word）
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars * 0.4);
}

// 章节拆分结果
export interface ParsedChapter {
  number: number;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

// 正则识别章节边界（借鉴 novelvids 的 NLP 策略）
// 支持：第X章、第X回、第X节、第X卷、Chapter N 等格式
const CHAPTER_PATTERN = /^\s*(第\s*([0-9零一二三四五六七八九十百千万亿]+)\s*[章回节篇卷])(.*)/gm;

export function splitNovelIntoChapters(text: string): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  const matches = [...text.matchAll(CHAPTER_PATTERN)];

  if (matches.length === 0) return []; // 无章节标记，返回空让调用方降级处理

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const marker = match[1]; // "第X章"
    const titleSuffix = (match[3] || '').trim();
    const fullTitle = titleSuffix ? `${marker} ${titleSuffix}` : marker;
    const startIndex = match.index!;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const contentStart = startIndex + match[0].length;
    const content = text.substring(contentStart, endIndex).trim();

    // 跳过空章节
    if (content.length < 10) continue;

    chapters.push({
      number: i + 1,
      title: fullTitle,
      content,
      startIndex,
      endIndex,
    });
  }

  return chapters;
}

// 按段落/章节边界智能分块，避免在句子中间截断
export function splitTextIntoChunks(text: string, maxCharsPerChunk: number): string[] {
  if (text.length <= maxCharsPerChunk) return [text];

  const chunks: string[] = [];
  const chapterSplitters = /(?=第[一二三四五六七八九十百千\d]+[章回节篇卷]|Chapter\s+\d+|\n#{1,3}\s)/gi;
  const sections = text.split(chapterSplitters).filter(s => s.trim());

  let currentChunk = '';
  for (const section of sections) {
    if (currentChunk.length + section.length > maxCharsPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    if (section.length > maxCharsPerChunk) {
      if (currentChunk) { chunks.push(currentChunk.trim()); currentChunk = ''; }
      const paragraphs = section.split(/\n\s*\n/);
      let subChunk = '';
      for (const para of paragraphs) {
        if (subChunk.length + para.length > maxCharsPerChunk && subChunk.length > 0) {
          chunks.push(subChunk.trim());
          subChunk = '';
        }
        subChunk += para + '\n\n';
      }
      if (subChunk.trim()) currentChunk = subChunk;
    } else {
      currentChunk += section;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

// 将多个章节合并成不超过 maxChars 的批次（用于逐批 LLM 调用）
function batchChapters(chapters: ParsedChapter[], maxCharsPerBatch: number): ParsedChapter[][] {
  const batches: ParsedChapter[][] = [];
  let currentBatch: ParsedChapter[] = [];
  let currentSize = 0;

  for (const ch of chapters) {
    // 如果单章超过上限，截断内容保留前后部分（中间省略）
    if (ch.content.length > maxCharsPerBatch) {
      // 先把当前积累的批次推出去
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      // 截断：保留前60%和后20%，中间用省略标记
      const keepFront = Math.floor(maxCharsPerBatch * 0.6);
      const keepBack = Math.floor(maxCharsPerBatch * 0.2);
      const truncated = ch.content.substring(0, keepFront)
        + '\n\n[...中间内容省略...]\n\n'
        + ch.content.substring(ch.content.length - keepBack);
      batches.push([{ ...ch, content: truncated }]);
      continue;
    }
    if (currentSize + ch.content.length > maxCharsPerBatch && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(ch);
    currentSize += ch.content.length;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

// 分块分析的 system prompt（与单次分析相同，但标注是第几块）
const ANALYZE_SYSTEM_PROMPT = `你是一位专业的影视编剧，擅长将小说/故事转化为 AI 视频短剧。
请分析以下小说/故事片段，提取所有关键信息用于后续剧本和分镜生成。

## 分析要求
1. 提取核心冲突、主题、情感基调
2. 识别所有角色，区分主角/配角/龙套，详细描述外貌特征（发型、服装、体型、年龄、标志性特征）
3. 识别所有重要场景/地点，详细描述环境（建筑风格、氛围、光线、色调）
4. 按章节/段落提取情节要点，标注情感基调和关键事件
5. 为每个角色生成中文生图提示词（用于 AI 生图工具生成角色参考图）
6. 为每个场景生成中文生图提示词
7. 为每个场景提供固定物理属性描述（baseDescription）和基准生图提示词（baseVisualPrompt），只描述空场景本身
8. 标注场景间的空间关系、父级场景、相邻场景及双向可见性

请以 JSON 格式返回：
{
  "title": "故事标题（如果能从片段中判断）",
  "summary": "200字以内的片段梗概",
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist/supporting/minor",
      "description": "详细外貌描述（发型、服装、体型、年龄、标志性特征等）",
      "personality": "性格特征和行为模式",
      "visualPrompt": "中文生图提示词，如：17岁高中男生，凌乱黑发，锐利眼神，穿着旧校服"
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "description": "详细环境描述（建筑风格、氛围、光线、季节等）",
      "baseDescription": "固定物理属性：空间布局、家具、建筑风格、光线方向等（不含人物和活动）",
      "baseVisualPrompt": "基准生图提示词（只描述空场景），如：中国南方小城中学教室，6排木质课桌椅，前方绿色黑板，左侧大窗户，白色墙壁，水泥地面",
      "visualPrompt": "中文生图提示词，如：老旧教学楼走廊，午后阳光斜照",
      "spatialRelation": "空间位置描述，如：位于教学楼二楼东侧，窗户朝南面向操场",
      "parentName": "父级场景名（如教室的父级是教学楼），无则留空",
      "adjacentLocations": [
        { "name": "相邻场景名", "direction": "方位", "visibleFrom": true }
      ]
    }
  ],
  "plotPoints": [
    {
      "chapter": 1,
      "summary": "情节概要",
      "emotionalTone": "情感基调",
      "keyEvents": ["关键事件1", "关键事件2"]
    }
  ],
  "themes": ["主题1", "主题2"]
}`;

// 合并多个分块分析结果
function mergeAnalysisResults(
  results: Array<{ title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, string>>; plotPoints?: PlotPoint[]; themes?: string[] }>,
): { title: string; summary: string; characters: Array<Record<string, string>>; locations: Array<Record<string, string>>; plotPoints: PlotPoint[]; themes: string[] } {
  // 标题取第一个非空的
  const title = results.find(r => r.title)?.title || '未命名';

  // 摘要拼接
  const summary = results.map(r => r.summary || '').filter(Boolean).join(' ').substring(0, 500);

  // 角色去重（按名字）
  const charMap = new Map<string, Record<string, string>>();
  for (const r of results) {
    for (const c of (r.characters || [])) {
      const name = c.name || '';
      if (!name) continue;
      const existing = charMap.get(name);
      if (!existing || (c.description || '').length > (existing.description || '').length) {
        charMap.set(name, c); // 保留描述更详细的版本
      }
    }
  }

  // 场景去重（按名字），保留空间结构字段
  const locMap = new Map<string, Record<string, string>>();
  for (const r of results) {
    for (const l of (r.locations || [])) {
      const name = l.name || '';
      if (!name) continue;
      const existing = locMap.get(name);
      if (!existing) {
        locMap.set(name, l);
      } else {
        // 保留更详细的版本
        if ((l.description || '').length > (existing.description || '').length) existing.description = l.description;
        if ((l.baseDescription || '').length > (existing.baseDescription || '').length) existing.baseDescription = l.baseDescription;
        if ((l.baseVisualPrompt || '').length > (existing.baseVisualPrompt || '').length) existing.baseVisualPrompt = l.baseVisualPrompt;
        if ((l.visualPrompt || '').length > (existing.visualPrompt || '').length) existing.visualPrompt = l.visualPrompt;
        if ((l.spatialRelation || '').length > (existing.spatialRelation || '').length) existing.spatialRelation = l.spatialRelation;
        if (!existing.parentName && l.parentName) existing.parentName = l.parentName;
      }
    }
  }

  // 情节点按 chapter 排序合并
  const allPlots: PlotPoint[] = [];
  let chapterOffset = 0;
  for (const r of results) {
    for (const p of (r.plotPoints || [])) {
      allPlots.push({ ...p, chapter: p.chapter + chapterOffset });
    }
    const maxChapter = Math.max(0, ...(r.plotPoints || []).map(p => p.chapter));
    chapterOffset += maxChapter;
  }

  // 主题去重
  const themes = [...new Set(results.flatMap(r => r.themes || []))];

  return {
    title,
    summary,
    characters: [...charMap.values()],
    locations: [...locMap.values()],
    plotPoints: allPlots,
    themes,
  };
}

// 场景智能合并去重：将同一物理空间的不同状态合并为一个基础场景 + variants
// 例如 "高二九班教室（日常课堂）" + "高二九班教室（考试状态）" → "高二九班教室" + variants: [{label:"日常课堂",...},{label:"考试状态",...}]
async function mergeAndDeduplicateLocations(
  projectId: string,
  locations: LocationInfo[],
  maxCount: number,
  config: LLMConfig,
  progress: AnalyzeProgressCallback,
): Promise<LocationInfo[]> {
  const locSummary = locations.map(l => `${l.id}: ${l.originalName} — ${l.description?.substring(0, 60) || ''}`).join('\n');

  const mergePrompt = `你是一位专业的影视场景管理师。以下是从小说中提取的 ${locations.length} 个场景，但其中大量是同一物理空间的不同状态（如"教室（上课）"和"教室（考试）"本质是同一个教室）。

请将它们合并为不超过 ${maxCount} 个独立的物理场景。

## 合并规则
1. 同一物理空间的不同状态/时间/活动合并为一个场景，差异部分记录为 variants
2. 保留最具代表性的名称作为场景名
3. 合并后的 description 描述该空间的固定物理属性（不含人物和活动）
4. variants 记录该空间出现过的不同状态（如"日常课堂"、"考试状态"、"空教室"）
5. 优先保留主要剧情发生的场景，次要/一次性场景可以合并到更大的区域
6. 每个合并后的场景标注它包含了哪些原始场景 ID

## 场景列表
${locSummary}

返回 JSON 数组：
[
  {
    "name": "合并后的场景名",
    "mergedIds": ["S01", "S05", "S12"],
    "description": "该物理空间的固定属性描述",
    "variants": [
      { "label": "日常课堂", "description": "学生坐在座位上，老师在讲台授课" },
      { "label": "考试状态", "description": "桌椅间距拉大，学生埋头答题" }
    ]
  }
]`;

  const startTime = Date.now();
  const result = await chatCompletionJSON<Array<{
    name: string;
    mergedIds: string[];
    description: string;
    variants?: Array<{ label: string; description: string }>;
  }>>(mergePrompt, '请根据上述规则合并场景');
  logLLMCall({ projectId, step: 'location_merge', provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

  if (!result.success || !result.data || !Array.isArray(result.data)) {
    console.log(`[drama] 场景合并 LLM 调用失败: ${result.error}，保留原始场景`);
    return locations;
  }

  // 构建 ID → 原始场景的映射
  const idToLoc = new Map(locations.map(l => [l.id, l]));
  const merged: LocationInfo[] = [];

  for (let i = 0; i < result.data.length; i++) {
    const group = result.data[i];
    const newId = `S${String(i + 1).padStart(2, '0')}`;

    // 从合并的原始场景中找到最详细的那个作为基础
    const sourceLocs = (group.mergedIds || []).map(id => idToLoc.get(id)).filter(Boolean) as LocationInfo[];
    const bestSource = sourceLocs.sort((a, b) =>
      (b.baseDescription?.length || 0) + (b.baseVisualPrompt?.length || 0) -
      (a.baseDescription?.length || 0) - (a.baseVisualPrompt?.length || 0)
    )[0];

    merged.push({
      id: newId,
      originalName: group.name || bestSource?.originalName || '',
      newName: group.name || bestSource?.newName || '',
      description: group.description || bestSource?.description || '',
      visualPrompt: bestSource?.visualPrompt || '',
      baseDescription: bestSource?.baseDescription || group.description || '',
      baseVisualPrompt: bestSource?.baseVisualPrompt || bestSource?.visualPrompt || '',
      spatialRelation: bestSource?.spatialRelation || '',
      parentId: bestSource?.parentId || '',
      adjacentLocations: bestSource?.adjacentLocations || [],
      variants: group.variants || [],
    });
  }

  // 处理未被合并的场景（LLM 可能遗漏了一些）
  const mergedOrigIds = new Set(result.data.flatMap(g => g.mergedIds || []));
  for (const loc of locations) {
    if (!mergedOrigIds.has(loc.id)) {
      const newId = `S${String(merged.length + 1).padStart(2, '0')}`;
      merged.push({ ...loc, id: newId });
    }
  }

  return merged;
}

// 根据 locations 的 parentId 和 adjacentLocations 构建空间结构地图
function buildSpatialMap(locations: LocationInfo[]): SpatialMap {
  // 构建层级树文本
  const idToLoc = new Map(locations.map(l => [l.id, l]));
  const roots: LocationInfo[] = [];
  const children = new Map<string, LocationInfo[]>();

  for (const loc of locations) {
    if (loc.parentId && idToLoc.has(loc.parentId)) {
      const list = children.get(loc.parentId) || [];
      list.push(loc);
      children.set(loc.parentId, list);
    } else {
      roots.push(loc);
    }
  }

  // 递归构建树文本
  const buildTreeText = (locs: LocationInfo[], indent: string): string => {
    return locs.map((loc, i) => {
      const isLast = i === locs.length - 1;
      const prefix = indent + (isLast ? '└── ' : '├── ');
      const childIndent = indent + (isLast ? '    ' : '│   ');
      const kids = children.get(loc.id) || [];
      const line = `${prefix}${loc.newName}(${loc.id})${loc.spatialRelation ? ` — ${loc.spatialRelation}` : ''}`;
      if (kids.length > 0) {
        return line + '\n' + buildTreeText(kids, childIndent);
      }
      return line;
    }).join('\n');
  };

  const tree = buildTreeText(roots, '');

  // 收集双向可见关系（去重）
  const relSet = new Set<string>();
  const relations: SpatialMap['relations'] = [];
  for (const loc of locations) {
    for (const adj of (loc.adjacentLocations || [])) {
      if (!adj.id) continue;
      const key = [loc.id, adj.id].sort().join('-');
      if (relSet.has(key)) continue;
      relSet.add(key);
      relations.push({
        from: loc.id,
        to: adj.id,
        direction: adj.direction,
        bidirectionalView: adj.visibleFrom,
      });
    }
  }

  return { tree, relations };
}

// 根据场景 ID 获取完整的场景生图 prompt（baseVisualPrompt + 镜头变量）
// 用于分镜生成时保证同一场景跨集一致
function buildLocationPromptForShot(loc: LocationInfo, shotContext: string): string {
  const base = loc.baseVisualPrompt || loc.visualPrompt || loc.description;
  if (!shotContext) return base;
  return `${base}，${shotContext}`;
}

// 构建场景空间上下文（用于脚本生成 prompt，让 LLM 了解场景间的空间关系）
function buildSpatialContext(locations: LocationInfo[], spatialMap?: SpatialMap): string {
  let ctx = locations.map(l => {
    const parts = [`- ${l.newName}(${l.id}): ${l.description}`];
    if (l.baseDescription) parts.push(`  固定布局: ${l.baseDescription}`);
    if (l.spatialRelation) parts.push(`  空间位置: ${l.spatialRelation}`);
    if (l.variants && l.variants.length > 0) {
      parts.push(`  状态变体: ${l.variants.map(v => v.label).join('、')}（同一物理空间，共享基准图，用同一个场景ID引用）`);
    }
    if (l.adjacentLocations && l.adjacentLocations.length > 0) {
      const adjNames = l.adjacentLocations.map(a => {
        const adjLoc = locations.find(ll => ll.id === a.id);
        return adjLoc ? `${adjLoc.newName}(${a.direction}${a.visibleFrom ? ',互相可见' : ''})` : '';
      }).filter(Boolean);
      if (adjNames.length > 0) parts.push(`  相邻: ${adjNames.join('、')}`);
    }
    return parts.join('\n');
  }).join('\n');

  if (spatialMap?.tree) {
    ctx += `\n\n## 空间层级结构\n${spatialMap.tree}`;
  }
  if (spatialMap?.relations && spatialMap.relations.length > 0) {
    const viewRules = spatialMap.relations
      .filter(r => r.bidirectionalView)
      .map(r => {
        const fromLoc = locations.find(l => l.id === r.from);
        const toLoc = locations.find(l => l.id === r.to);
        return fromLoc && toLoc ? `${fromLoc.newName} ↔ ${toLoc.newName} (${r.direction}，双向可见)` : '';
      })
      .filter(Boolean);
    if (viewRules.length > 0) {
      ctx += `\n\n## 视角互见规则（从A看到B，则从B也能看到A所在区域）\n${viewRules.join('\n')}`;
    }
  }

  return ctx;
}

// 第1步：小说分析 - 三层策略
// 策略A（优先）：正则章节拆分 → 逐章/批次实体提取 → 跨章节增量合并
// 策略B（降级）：短文本直接分析 / 中等文本分块分析 / 超长文本递归压缩
// 百万字小说优先走策略A，保留每章细节不丢失
export type AnalyzeProgressCallback = (step: string, detail: string) => void;

// 逐章实体提取的 system prompt（比全量分析更聚焦，提取质量更高）
// 轻量版：只提取核心实体，不要求 visualPrompt 等长文本，大幅减少输出量避免超时
const CHAPTER_EXTRACT_PROMPT = `你是一位专业的影视编剧助手。请分析以下小说章节，快速提取核心实体信息。

## 提取要求（精简版，只提取关键信息）
1. 提取所有出现的角色：名字、别名、身份、简短外貌描述、性格关键词
2. 提取所有场景/地点：名称、别名、简短环境描述
3. 提取本章核心情节（关键事件、情感基调）
4. 标注场景的父级场景和相邻关系

注意：visualPrompt、baseDescription、baseVisualPrompt 等详细生图提示词不需要在此阶段生成，后续会单独精炼。

请以 JSON 格式返回：
{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1"],
      "role": "protagonist/supporting/minor",
      "description": "简短外貌描述（50字以内：性别、年龄、关键外貌特征、标志性服装）",
      "personality": "性格关键词（20字以内）"
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "aliases": ["别名"],
      "description": "简短环境描述（50字以内）",
      "spatialRelation": "空间位置关系（20字以内）",
      "parentName": "父级场景名",
      "adjacentLocations": [{ "name": "相邻场景", "direction": "方位", "visibleFrom": true }]
    }
  ],
  "plotPoints": [
    {
      "summary": "情节概要（30字以内）",
      "emotionalTone": "情感基调",
      "keyEvents": ["关键事件"]
    }
  ],
  "chapterSummary": "本章100字以内摘要"
}`;

// 跨章节增量合并实体（借鉴 novelvids 的 Asset 增量合并策略）
function mergeChapterEntities(
  accumulated: { characters: Map<string, Record<string, unknown>>; locations: Map<string, Record<string, unknown>>; plotPoints: PlotPoint[]; summaries: string[]; themes: string[] },
  chapterResult: Record<string, unknown>,
  chapterNumber: number,
): void {
  // 合并角色：按名字或别名匹配，保留更详细的描述
  const chars = (chapterResult.characters || []) as Array<Record<string, unknown>>;
  for (const c of chars) {
    const name = (c.name as string) || '';
    if (!name) continue;
    const aliases = (c.aliases as string[]) || [];
    // 检查是否已存在（按名字或别名匹配）
    let existingKey: string | null = null;
    for (const [key, existing] of accumulated.characters) {
      const existingAliases = (existing.aliases as string[]) || [];
      if (key === name || existingAliases.includes(name) || aliases.includes(key)) {
        existingKey = key;
        break;
      }
    }
    if (existingKey) {
      const existing = accumulated.characters.get(existingKey)!;
      // 合并别名
      const mergedAliases = [...new Set([...(existing.aliases as string[] || []), ...aliases, name])].filter(a => a !== existingKey);
      existing.aliases = mergedAliases;
      // 保留更详细的描述
      if (((c.description as string) || '').length > ((existing.description as string) || '').length) {
        existing.description = c.description;
      }
      if (((c.personality as string) || '').length > ((existing.personality as string) || '').length) {
        existing.personality = c.personality;
      }
      if (((c.visualPrompt as string) || '').length > ((existing.visualPrompt as string) || '').length) {
        existing.visualPrompt = c.visualPrompt;
      }
      // 升级角色重要性（minor → supporting → protagonist）
      const roleRank = { protagonist: 3, supporting: 2, minor: 1 };
      const existingRank = roleRank[(existing.role as string) as keyof typeof roleRank] || 1;
      const newRank = roleRank[(c.role as string) as keyof typeof roleRank] || 1;
      if (newRank > existingRank) existing.role = c.role;
      // 记录出现章节
      const chapters = (existing._chapters as number[]) || [];
      if (!chapters.includes(chapterNumber)) chapters.push(chapterNumber);
      existing._chapters = chapters;
    } else {
      accumulated.characters.set(name, { ...c, _chapters: [chapterNumber] });
    }
  }

  // 合并场景：按名字或别名匹配
  const locs = (chapterResult.locations || []) as Array<Record<string, unknown>>;
  for (const l of locs) {
    const name = (l.name as string) || '';
    if (!name) continue;
    const aliases = (l.aliases as string[]) || [];
    let existingKey: string | null = null;
    for (const [key, existing] of accumulated.locations) {
      const existingAliases = (existing.aliases as string[]) || [];
      if (key === name || existingAliases.includes(name) || aliases.includes(key)) {
        existingKey = key;
        break;
      }
    }
    if (existingKey) {
      const existing = accumulated.locations.get(existingKey)!;
      const mergedAliases = [...new Set([...(existing.aliases as string[] || []), ...aliases, name])].filter(a => a !== existingKey);
      existing.aliases = mergedAliases;
      if (((l.description as string) || '').length > ((existing.description as string) || '').length) {
        existing.description = l.description;
      }
      if (((l.visualPrompt as string) || '').length > ((existing.visualPrompt as string) || '').length) {
        existing.visualPrompt = l.visualPrompt;
      }
      // 合并空间结构字段：保留更详细的版本
      if (((l.baseDescription as string) || '').length > ((existing.baseDescription as string) || '').length) {
        existing.baseDescription = l.baseDescription;
      }
      if (((l.baseVisualPrompt as string) || '').length > ((existing.baseVisualPrompt as string) || '').length) {
        existing.baseVisualPrompt = l.baseVisualPrompt;
      }
      if (((l.spatialRelation as string) || '').length > ((existing.spatialRelation as string) || '').length) {
        existing.spatialRelation = l.spatialRelation;
      }
      if (!existing.parentName && l.parentName) {
        existing.parentName = l.parentName;
      }
      // 合并相邻场景列表（去重）
      const existingAdj = (existing.adjacentLocations as Array<Record<string, unknown>>) || [];
      const newAdj = (l.adjacentLocations as Array<Record<string, unknown>>) || [];
      const adjMap = new Map<string, Record<string, unknown>>();
      for (const a of [...existingAdj, ...newAdj]) {
        const adjName = (a.name as string) || '';
        if (adjName && !adjMap.has(adjName)) adjMap.set(adjName, a);
      }
      existing.adjacentLocations = [...adjMap.values()];
    } else {
      accumulated.locations.set(name, { ...l });
    }
  }

  // 追加情节点
  const plots = (chapterResult.plotPoints || []) as PlotPoint[];
  for (const p of plots) {
    accumulated.plotPoints.push({ ...p, chapter: chapterNumber });
  }

  // 追加章节摘要
  if (chapterResult.chapterSummary) {
    accumulated.summaries.push(`第${chapterNumber}章: ${chapterResult.chapterSummary}`);
  }
}

// 策略A：章节拆分 → 逐批实体提取 → EntityGraph 增量合并 → 精炼
async function analyzeByChapters(
  projectId: string,
  chapters: ParsedChapter[],
  maxCharsPerBatch: number,
  config: LLMConfig,
  progress: AnalyzeProgressCallback,
): Promise<{ title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, unknown>>; plotPoints?: PlotPoint[]; themes?: string[]; graph?: EntityGraph }> {
  const extractBatchLimit = Math.min(maxCharsPerBatch, 6000);
  const batches = batchChapters(chapters, extractBatchLimit);
  const CONCURRENCY = Math.min(12, batches.length);
  console.log(`[drama] 章节分析: ${chapters.length} 章, 分 ${batches.length} 批处理, 并发 ${CONCURRENCY}, 每批上限 ${extractBatchLimit} 字`);
  progress('章节分析', `识别到 ${chapters.length} 个章节，分 ${batches.length} 批提取实体（并发 ${CONCURRENCY}）...`);

  // 存储每批次的结果，保证按顺序合并到图
  const batchResults: Array<{ success: boolean; data?: Record<string, unknown>; batchIndex: number }> = new Array(batches.length);
  let completedCount = 0;

  const processBatch = async (bi: number) => {
    const batch = batches[bi];
    const chapterRange = batch.length === 1
      ? `第${batch[0].number}章`
      : `第${batch[0].number}-${batch[batch.length - 1].number}章`;
    const batchText = batch.map(ch => `=== ${ch.title} ===\n${ch.content}`).join('\n\n');
    const userPrompt = `以下是小说的 ${chapterRange}（共 ${chapters.length} 章中的第 ${bi + 1} 批）。请提取所有实体信息。\n\n${batchText}`;

    let result: { success: boolean; data?: Record<string, unknown>; error?: string } = { success: false };
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        console.log(`[drama] 批次 ${bi + 1}/${batches.length} 第 ${retry + 1} 次重试...`);
        await new Promise(r => setTimeout(r, 5000 * retry));
      }
      const startTime = Date.now();
      result = await chatCompletionJSON<Record<string, unknown>>(CHAPTER_EXTRACT_PROMPT, userPrompt, { timeoutMs: 120000 });
      logLLMCall({ projectId, step: `chapter_extract_${bi + 1}${retry > 0 ? `_retry${retry}` : ''}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });
      if (result.success) break;
    }
    batchResults[bi] = { success: result.success, data: result.data, batchIndex: bi };
    completedCount++;
    console.log(`[drama] 批次 ${bi + 1}/${batches.length} ${result.success ? '完成' : '失败: ' + result.error}`);
    progress('章节分析', `${completedCount}/${batches.length} 批完成...`);
  };

  // 并发执行
  const queue = Array.from({ length: batches.length }, (_, i) => i);
  const running: Promise<void>[] = [];
  while (queue.length > 0 || running.length > 0) {
    while (running.length < CONCURRENCY && queue.length > 0) {
      const bi = queue.shift()!;
      const p = processBatch(bi).then(() => { running.splice(running.indexOf(p), 1); });
      running.push(p);
    }
    if (running.length > 0) await Promise.race(running);
  }

  // 按批次顺序 ingest 到 EntityGraph
  const graph = new EntityGraph();
  for (let bi = 0; bi < batches.length; bi++) {
    const br = batchResults[bi];
    if (br?.success && br.data) {
      for (const ch of batches[bi]) {
        graph.ingestChapter(ch.number, br.data);
      }
    }
  }
  const gStats = graph.stats();
  console.log(`[drama] EntityGraph: ${gStats.characters} 角色, ${gStats.locations} 场景, ${gStats.edges} 关系边`);

  // 精炼阶段
  progress('整合精炼', `正在整合 ${chapters.length} 章的分析结果...`);
  const allCharacters = graph.exportCharactersForRefine();
  const allLocations = graph.exportLocationsForRefine();

  // 分批精炼角色
  const REFINE_CHAR_BATCH = 15;
  const charRefinePrompt = `你是一位专业编剧兼AI绘画提示词专家。以下是从小说中提取的角色列表（可能有重复）。
请精炼：
1. 合并同一人的不同称呼/别名，但保留所有有名字的独立角色
2. 确认每个角色的主次关系（protagonist/supporting/minor）
3. 根据小说背景（人名、地名、文化背景）判断角色的民族/人种
4. 为每个角色生成详细的中文 visualPrompt（用于AI生图），至少80字，开头必须写明人种
返回 JSON 数组：[{ "name": "...", "role": "...", "description": "...", "personality": "...", "visualPrompt": "..." }]`;

  const charBatchTasks = [];
  for (let i = 0; i < allCharacters.length; i += REFINE_CHAR_BATCH) {
    const batch = allCharacters.slice(i, i + REFINE_CHAR_BATCH);
    charBatchTasks.push((async () => {
      progress('整合精炼', `精炼角色 ${i + 1}-${Math.min(i + REFINE_CHAR_BATCH, allCharacters.length)}/${allCharacters.length}...`);
      const st = Date.now();
      const r = await chatCompletionJSON<Array<Record<string, string>>>(charRefinePrompt, JSON.stringify(batch));
      logLLMCall({ projectId, step: `refine_chars_${i}`, provider: config.provider, model: config.model, durationMs: Date.now() - st, success: r.success, error: r.error });
      if (r.success && r.data) return Array.isArray(r.data) ? r.data : [];
      return batch as Array<Record<string, string>>;
    })());
  }

  // 分批精炼场景（不再要求输出空间关系，由图保证）
  const REFINE_LOC_BATCH = 20;
  const locRefinePrompt = `你是一位专业编剧兼AI绘画提示词专家。以下是从小说中提取的场景列表（可能有重复）。
请精炼：
1. 合并同一地点的不同描述
2. 保留所有有独立功能的场景
3. 根据小说背景判断场景所在的国家/地区文化风格
4. 为每个场景生成详细的中文 visualPrompt（至少60字）
5. 为每个场景生成 baseDescription（固定物理属性）
6. 为每个场景生成 baseVisualPrompt（基准空场景生图提示词）
返回 JSON 数组：[{ "name": "...", "description": "...", "visualPrompt": "...", "baseDescription": "...", "baseVisualPrompt": "..." }]`;

  const locBatchTasks = [];
  for (let i = 0; i < allLocations.length; i += REFINE_LOC_BATCH) {
    const batch = allLocations.slice(i, i + REFINE_LOC_BATCH);
    locBatchTasks.push((async () => {
      progress('整合精炼', `精炼场景 ${i + 1}-${Math.min(i + REFINE_LOC_BATCH, allLocations.length)}/${allLocations.length}...`);
      const st = Date.now();
      const r = await chatCompletionJSON<Array<Record<string, string>>>(locRefinePrompt, JSON.stringify(batch));
      logLLMCall({ projectId, step: `refine_locs_${i}`, provider: config.provider, model: config.model, durationMs: Date.now() - st, success: r.success, error: r.error });
      if (r.success && r.data) return Array.isArray(r.data) ? r.data : [];
      return batch as Array<Record<string, string>>;
    })());
  }

  const [charResults, locResults] = await Promise.all([
    Promise.all(charBatchTasks),
    Promise.all(locBatchTasks),
  ]);
  const finalCharacters = charResults.flat();

  // 精炼后从图中补回空间关系
  const rawFinalLocations = locResults.flat();
  const graphLocByName = new Map(allLocations.map(gl => [gl.name as string, gl]));
  const finalLocations: Array<Record<string, unknown>> = rawFinalLocations.map(refined => {
    const name = (refined.name as string) || '';
    const graphLoc = graphLocByName.get(name);
    if (!graphLoc) return refined;
    return {
      ...refined,
      spatialRelation: (graphLoc.spatialRelation as string) || '',
      parentName: (graphLoc.parentName as string) || '',
      adjacentLocations: graphLoc.adjacentLocations || [],
    };
  });

  // 精炼摘要
  progress('整合精炼', '生成故事梗概和主题...');
  const summaryRefinePrompt = `你是一位专业编剧。根据以下章节摘要和情节点，生成精炼结果。
严格要求：
- title：吸引人的标题（不超过10个字）
- summary：300字以内完整故事梗概
- plotPoints：最关键的情节转折点（最多20个），按章节排序
- themes：2-5个核心主题
返回 JSON：{ "title": "...", "summary": "...", "plotPoints": [...], "themes": [...] }`;

  const summaryInput = JSON.stringify({
    summaries: graph.summaries.slice(0, 15),
    plotPoints: graph.plotPoints.slice(0, 20),
  });

  let summaryResult: { success: boolean; data?: Record<string, unknown>; error?: string } = { success: false };
  for (let retry = 0; retry < 3; retry++) {
    if (retry > 0) await new Promise(r => setTimeout(r, 2000));
    const stSum = Date.now();
    summaryResult = await chatCompletionJSON<Record<string, unknown>>(summaryRefinePrompt, summaryInput);
    logLLMCall({ projectId, step: `refine_summary${retry > 0 ? `_retry${retry}` : ''}`, provider: config.provider, model: config.model, durationMs: Date.now() - stSum, success: summaryResult.success, error: summaryResult.error });
    if (summaryResult.success && summaryResult.data?.title && summaryResult.data?.summary) break;
  }

  return {
    title: (summaryResult.data?.title as string) || '未命名',
    summary: (summaryResult.data?.summary as string) || graph.summaries.slice(0, 5).join(' ').substring(0, 500),
    characters: finalCharacters,
    locations: finalLocations,
    plotPoints: (summaryResult.data?.plotPoints as PlotPoint[]) || graph.plotPoints,
    themes: (summaryResult.data?.themes as string[]) || [],
    graph,
  };
}

export async function analyzeNovel(
  projectId: string,
  novelText: string,
  onProgress?: AnalyzeProgressCallback,
): Promise<{ success: boolean; project?: DramaProject; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const config = getLLMConfig();
  const modelContextLimit = getModelContextLimit(config);
  const systemPromptTokens = 1500;
  const outputTokens = config.maxTokens || 8000;
  const safeInputTokens = modelContextLimit - systemPromptTokens - outputTokens;
  const maxCharsPerChunk = Math.floor(safeInputTokens / 1.5);

  const progress = onProgress || (() => {});
  console.log(`[drama] 小说长度: ${novelText.length} 字, 模型上下文: ${modelContextLimit}, 单块上限: ${maxCharsPerChunk} 字`);
  progress('准备', `小说 ${novelText.length} 字，计算分块策略...`);

  let analysis: { title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, unknown>>; plotPoints?: PlotPoint[]; themes?: string[]; graph?: EntityGraph };

  // 策略A：尝试章节拆分（适用于有章节标记的长篇小说）
  const chapters = splitNovelIntoChapters(novelText);

  if (chapters.length >= 3) {
    // 有足够的章节标记，走逐章分析策略（保留细节不丢失）
    console.log(`[drama] 策略A: 识别到 ${chapters.length} 个章节，走逐章实体提取`);
    progress('章节拆分', `识别到 ${chapters.length} 个章节 (${(novelText.length / 10000).toFixed(1)} 万字)，逐章提取实体...`);
    analysis = await analyzeByChapters(projectId, chapters, maxCharsPerChunk, config, progress);
  } else if (novelText.length <= maxCharsPerChunk) {
    // 策略B-1：短文本，单次调用
    progress('分析', '短文本，直接分析...');
    const startTime = Date.now();
    const result = await chatCompletionJSON<Record<string, unknown>>(ANALYZE_SYSTEM_PROMPT, novelText);
    logLLMCall({ projectId, step: 'analyze', provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });
    if (!result.success || !result.data) return { success: false, error: result.error || 'LLM 分析失败' };
    analysis = result.data as typeof analysis;
  } else {
    // 策略B-2/B-3：无章节标记的长文本，走原有压缩策略
    const rawChunks = splitTextIntoChunks(novelText, maxCharsPerChunk);

    if (rawChunks.length <= 10) {
      progress('分块分析', `${rawChunks.length} 个分块，逐块分析中...`);
      analysis = await analyzeChunksAndMerge(projectId, rawChunks, maxCharsPerChunk, config, progress);
    } else {
      progress('压缩分析', `超长文本 ${(novelText.length / 10000).toFixed(1)} 万字，开始分层压缩...`);
      const compressedText = await recursiveCompress(projectId, novelText, maxCharsPerChunk, config, progress, 1);
      progress('精细分析', `压缩完成 (${(compressedText.length / 10000).toFixed(1)} 万字)，正在做精细分析...`);
      console.log(`[drama] 多层压缩: ${novelText.length} 字 → ${compressedText.length} 字 (压缩率 ${((1 - compressedText.length / novelText.length) * 100).toFixed(1)}%)`);
      const compressedChunks = splitTextIntoChunks(compressedText, maxCharsPerChunk);
      analysis = await analyzeChunksAndMerge(projectId, compressedChunks, maxCharsPerChunk, config, progress);
    }
  }

  const novel: NovelAnalysis = {
    title: analysis.title || '未命名',
    originalTitle: analysis.title || '',
    summary: analysis.summary || '',
    characters: (analysis.characters || []).map((c, i) => ({
      id: `C${String(i + 1).padStart(2, '0')}`,
      originalName: c.name || '',
      newName: c.name || '',
      role: (c.role as CharacterInfo['role']) || 'minor',
      description: c.description || '',
      personality: c.personality || '',
      visualPrompt: c.visualPrompt || '',
      imageUrls: [],
      confirmed: false,
    })),
    locations: (analysis.locations || []).map((l, i) => ({
      id: `S${String(i + 1).padStart(2, '0')}`,
      originalName: (l.name as string) || '',
      newName: (l.name as string) || '',
      description: (l.description as string) || '',
      visualPrompt: (l.visualPrompt as string) || '',
      baseDescription: (l.baseDescription as string) || '',
      baseVisualPrompt: (l.baseVisualPrompt as string) || '',
      spatialRelation: (l.spatialRelation as string) || '',
      parentId: '',  // 下面通过 parentName 解析
      adjacentLocations: [],  // 下面通过 adjacentLocations name 解析
    })),
    plotPoints: analysis.plotPoints || [],
    themes: analysis.themes || [],
    totalChapters: chapters.length > 0 ? chapters.length : (analysis.plotPoints || []).length,
  };

  // ====== 场景智能合并去重 ======
  // 根据集数计算合理场景上限，合并同一物理空间的不同状态为 variants
  const maxLocations = Math.min(Math.max(project.targetEpisodes * 2, 20), 50);
  if (novel.locations.length > maxLocations) {
    progress('场景合并', `${novel.locations.length} 个场景过多（目标 ${project.targetEpisodes} 集建议 ≤${maxLocations} 个），正在智能合并...`);
    const mergedLocs = await mergeAndDeduplicateLocations(projectId, novel.locations, maxLocations, config, progress);
    if (mergedLocs.length > 0 && mergedLocs.length < novel.locations.length) {
      novel.locations = mergedLocs;
      console.log(`[drama] 场景合并: ${analysis.locations?.length || 0} → ${novel.locations.length}`);
      progress('场景合并', `合并完成: ${novel.locations.length} 个独立场景`);
    }
  }

  // 构建空间结构：优先从 EntityGraph 获取关系，fallback 到 analysis.locations
  const locNameToId = new Map<string, string>();
  for (const loc of novel.locations) {
    locNameToId.set(loc.originalName, loc.id);
  }

  if (analysis.graph) {
    // 从 EntityGraph 的边关系直接构建空间结构
    const graph = analysis.graph;
    const graphLocByName = new Map(graph.getLocations().map(n => [n.name, n]));

    for (const loc of novel.locations) {
      const graphNode = graphLocByName.get(loc.originalName);
      if (!graphNode) continue;

      // 从 spatial_parent 边获取父级
      const parentEdges = graph.getEdges(graphNode.id, 'spatial_parent');
      for (const pe of parentEdges) {
        const parentNodeId = pe.from === graphNode.id ? pe.to : pe.from;
        const parentNode = graph.getLocations().find(n => n.id === parentNodeId);
        if (parentNode) {
          const parentLocId = locNameToId.get(parentNode.name);
          if (parentLocId) loc.parentId = parentLocId;
        }
      }

      // 从 spatial_adjacent 边获取相邻关系
      const adjEdges = graph.getEdges(graphNode.id, 'spatial_adjacent');
      loc.adjacentLocations = adjEdges.map(ae => {
        const otherNodeId = ae.from === graphNode.id ? ae.to : ae.from;
        const otherNode = graph.getLocations().find(n => n.id === otherNodeId);
        if (!otherNode) return null;
        const otherLocId = locNameToId.get(otherNode.name);
        if (!otherLocId) return null;
        return {
          id: otherLocId,
          direction: (ae.attrs.direction as string) || '',
          visibleFrom: (ae.attrs.visibleFrom as boolean) ?? true,
        };
      }).filter(Boolean) as Array<{ id: string; direction: string; visibleFrom: boolean }>;
    }
  } else {
    // Fallback：从 analysis.locations 按 name 匹配
    const rawLocByName = new Map<string, Record<string, unknown>>();
    for (const raw of (analysis.locations || [])) {
      const name = (raw.name as string) || '';
      if (name) rawLocByName.set(name, raw as Record<string, unknown>);
    }
    for (const loc of novel.locations) {
      const raw = rawLocByName.get(loc.originalName);
      if (!raw) continue;
      const parentName = (raw.parentName as string) || '';
      if (parentName) {
        loc.parentId = locNameToId.get(parentName) || '';
      }
      const rawAdj = (raw.adjacentLocations as Array<Record<string, unknown>>) || [];
      loc.adjacentLocations = rawAdj
        .filter(a => (a.name as string))
        .map(a => ({
          id: locNameToId.get(a.name as string) || '',
          direction: (a.direction as string) || '',
          visibleFrom: (a.visibleFrom as boolean) ?? true,
        }))
        .filter(a => a.id);
    }
  }
  // 构建 spatialMap
  novel.spatialMap = buildSpatialMap(novel.locations);

  progress('完成', `分析完成: ${novel.characters.length} 角色, ${novel.locations.length} 场景, ${novel.plotPoints.length} 情节点`);
  // 保存 EntityGraph 到项目（贯穿整个创作流程）
  const graphData = analysis.graph ? analysis.graph.serialize() : undefined;
  updateProject(projectId, { novel, status: 'copyright_check', entityGraphData: graphData });
  return { success: true, project: getProject(projectId) };
}

// 摘要压缩 prompt（复用，避免重复定义）
const COMPRESS_SYSTEM_PROMPT = `你是一位专业编剧助手。请对以下小说片段做精炼摘要，提取核心信息。
要求：
1. 用 300 字以内概括这段内容的主要情节和冲突
2. 列出出现的所有重要角色名（含外貌描述关键词，如"张三: 高大、黑发、蓝衣"）
3. 列出出现的所有重要地点名（含环境关键词）
4. 列出 3-5 个关键事件或转折点

返回 JSON：
{
  "summary": "300字以内摘要",
  "characters": ["角色名: 外貌关键词"],
  "locations": ["地点名: 环境关键词"],
  "keyEvents": ["事件1", "事件2"]
}`;

// 对单个文本块做摘要压缩，返回压缩后的文本
async function compressChunk(
  text: string,
  projectId: string,
  stepLabel: string,
  config: LLMConfig,
): Promise<string> {
  const startTime = Date.now();
  const result = await chatCompletionJSON<{ summary: string; characters: string[]; locations: string[]; keyEvents: string[] }>(
    COMPRESS_SYSTEM_PROMPT, text,
  );
  logLLMCall({ projectId, step: stepLabel, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

  if (!result.success || !result.data) return ''; // 压缩失败返回空

  const d = result.data;
  return [
    d.summary || '',
    (d.characters || []).length > 0 ? `角色：${d.characters.join('、')}` : '',
    (d.locations || []).length > 0 ? `地点：${d.locations.join('、')}` : '',
    (d.keyEvents || []).length > 0 ? `事件：${d.keyEvents.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

// 递归压缩：将超长文本逐层压缩到可分析的长度
// 每层约 50:1 压缩率（原文 → 300字摘要/块）
// 最大递归深度 4 层，足以处理 ~5000万字
async function recursiveCompress(
  projectId: string,
  text: string,
  maxCharsPerChunk: number,
  config: LLMConfig,
  progress: AnalyzeProgressCallback,
  depth: number,
): Promise<string> {
  const MAX_DEPTH = 4;
  if (depth > MAX_DEPTH) {
    console.log(`[drama] 压缩达到最大深度 ${MAX_DEPTH}，截断处理`);
    return text.substring(0, maxCharsPerChunk * 10);
  }

  const chunks = splitTextIntoChunks(text, maxCharsPerChunk);

  // 如果块数 <= 10，已经足够短，直接返回
  if (chunks.length <= 10) return text;

  progress(`第${depth}层压缩`, `${(text.length / 10000).toFixed(1)} 万字，分 ${chunks.length} 块压缩中...`);
  console.log(`[drama] 第${depth}层压缩: ${text.length} 字, ${chunks.length} 块`);

  // 并发控制：每次最多 3 个并发请求，避免 API 限流
  const CONCURRENCY = 3;
  const summaries: string[] = new Array(chunks.length).fill('');

  for (let batchStart = 0; batchStart < chunks.length; batchStart += CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONCURRENCY, chunks.length);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      progress(`第${depth}层压缩`, `正在压缩第 ${i + 1}/${chunks.length} 块...`);
      batchPromises.push(
        compressChunk(chunks[i], projectId, `compress_L${depth}_${i + 1}`, config)
          .then(s => { summaries[i] = s; }),
      );
    }
    await Promise.all(batchPromises);
  }

  // 组装压缩结果
  const compressed = summaries
    .map((s, i) => s ? `=== 第${i + 1}段 ===\n${s}` : '')
    .filter(Boolean)
    .join('\n\n');

  const ratio = ((1 - compressed.length / text.length) * 100).toFixed(1);
  progress(`第${depth}层压缩`, `完成: ${text.length} → ${compressed.length} 字 (压缩 ${ratio}%)`);
  console.log(`[drama] 第${depth}层压缩完成: ${text.length} → ${compressed.length} 字 (${ratio}%)`);

  // 检查压缩后是否足够短
  const compressedChunks = splitTextIntoChunks(compressed, maxCharsPerChunk);
  if (compressedChunks.length <= 10) {
    return compressed; // 够短了
  }

  // 还是太长，递归再压缩一层
  return recursiveCompress(projectId, compressed, maxCharsPerChunk, config, progress, depth + 1);
}

// 分块分析 + 合并（复用逻辑，供短/中/长文本共用）
async function analyzeChunksAndMerge(
  projectId: string,
  chunks: string[],
  maxCharsPerChunk: number,
  config: LLMConfig,
  progress: AnalyzeProgressCallback,
): Promise<{ title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, string>>; plotPoints?: PlotPoint[]; themes?: string[] }> {
  const chunkResults: Array<Record<string, unknown>> = [];

  for (let i = 0; i < chunks.length; i++) {
    progress('分块分析', `正在分析第 ${i + 1}/${chunks.length} 块...`);
    const chunkPrompt = `这是小说的第 ${i + 1}/${chunks.length} 部分。请分析这个片段中出现的角色、场景和情节。`;
    const startTime = Date.now();
    const result = await chatCompletionJSON<Record<string, unknown>>(
      ANALYZE_SYSTEM_PROMPT,
      `${chunkPrompt}\n\n---\n\n${chunks[i]}`,
    );
    logLLMCall({ projectId, step: `analyze_chunk_${i + 1}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

    if (result.success && result.data) {
      chunkResults.push(result.data);
      console.log(`[drama] 分块 ${i + 1}/${chunks.length} 分析完成`);
    } else {
      console.log(`[drama] 分块 ${i + 1}/${chunks.length} 分析失败: ${result.error}`);
    }
  }

  if (chunkResults.length === 0) {
    return { title: '未命名', summary: '', characters: [], locations: [], plotPoints: [], themes: [] };
  }

  type AnalysisType = { title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, string>>; plotPoints?: PlotPoint[]; themes?: string[] };
  let analysis = mergeAnalysisResults(chunkResults as AnalysisType[]);

  // 多块时用一次 LLM 调用精炼合并结果
  if (chunkResults.length > 1) {
    progress('合并精炼', `正在合并 ${chunkResults.length} 个分块的分析结果...`);
    const mergePrompt = `你是一位专业编剧。以下是对一部长篇小说分段分析后的合并结果。
请精炼和整合这些信息：
1. 写一个完整的200字以内故事梗概（不是片段拼接）
2. 确认每个角色的主次关系（protagonist/supporting/minor），去除重复角色
3. 合并重复的场景
4. 按时间线重新排列情节点
5. 提炼核心主题
6. 为每个角色和场景补充中文 visualPrompt（如果缺失）

返回与输入相同的 JSON 格式。`;

    const startTime = Date.now();
    const mergeResult = await chatCompletionJSON<Record<string, unknown>>(
      mergePrompt,
      JSON.stringify(analysis).substring(0, maxCharsPerChunk),
    );
    logLLMCall({ projectId, step: 'analyze_merge', provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: mergeResult.success, error: mergeResult.error });

    if (mergeResult.success && mergeResult.data) {
      analysis = mergeResult.data as typeof analysis;
      console.log(`[drama] 合并精炼完成`);
    }
  }

  return analysis;
}

// 根据模型估算上下文窗口大小
function getModelContextLimit(config: LLMConfig): number {
  const model = (config.model || '').toLowerCase();
  // 常见模型上下文窗口
  if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) return 128000;
  if (model.includes('gpt-4')) return 8192;
  if (model.includes('gpt-3.5-turbo-16k')) return 16384;
  if (model.includes('gpt-3.5')) return 4096;
  if (model.includes('claude-3') || model.includes('claude-4')) return 200000;
  if (model.includes('claude-2')) return 100000;
  if (model.includes('gemini-pro') || model.includes('gemini-1.5') || model.includes('gemini-2')) return 1000000;
  if (model.includes('deepseek-chat') || model.includes('deepseek-v3')) return 64000;
  if (model.includes('deepseek-r1') || model.includes('deepseek-reasoner')) return 64000;
  if (model.includes('qwen-turbo') || model.includes('qwen2')) return 128000;
  if (model.includes('qwen-plus') || model.includes('qwen-max')) return 128000;
  if (model.includes('llama-3') || model.includes('llama3')) return 128000;
  if (model.includes('mistral')) return 32000;
  // 保守默认值
  return 32000;
}

// 第2步：版权改造 - 直接调用 LLM
export async function transformCopyright(projectId: string): Promise<{ success: boolean; project?: DramaProject; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const config = getLLMConfig();
  // 只处理主角和配角，龙套不需要版权改造
  const mainChars = project.novel.characters.filter(c => c.role !== 'minor');
  const locs = project.novel.locations;

  // 版权改造 system prompt（角色批次和场景批次共用基础指令）
  const charSystemPrompt = `你是一位版权合规专家兼AI绘画提示词专家。请对以下角色进行版权改造。

故事背景：${project.novel.summary?.substring(0, 300) || ''}

改造规则：
1. 所有角色名更换为全新名字，保持角色性格和关系不变
2. 公共领域作品（如水浒传、西游记等）可适度保留
3. 为每个角色设定默认服化道（costumeDesc）：日常服装、妆容特征、标志性道具
4. 为每个角色生成详细的中文 visualPrompt（用于AI生图），严格要求：
   - 开头必须写明人种/民族（如"中国人"、"东亚面孔"）
   - 必须包含：性别、具体年龄、身高体型、发型发色、五官特征、肤色
   - 必须包含：服装款式和颜色（如"蓝白条纹校服外套，深蓝校裤"）
   - 必须包含：配饰/道具、气质表情
   - visualPrompt 至少100字，不足视为不合格

返回 JSON：
{
  "characters": [
    {
      "originalName": "原名",
      "newName": "新名",
      "adjustedDescription": "调整后的中文外貌描述",
      "visualPrompt": "至少100字的详细中文生图提示词",
      "costumeDesc": "默认服化道描述"
    }
  ]
}`;

  const locSystemPrompt = `你是一位版权合规专家兼AI绘画提示词专家。请对以下场景/地点进行版权改造。

故事背景：${project.novel.summary?.substring(0, 300) || ''}

改造规则：
1. 所有地名更换，保持地理特征和氛围不变
2. 公共领域作品可适度保留
3. 为每个场景生成详细的中文 visualPrompt（用于AI生图），严格要求：
   - 开头必须写明地域文化风格（如"中国南方小城"、"中式校园"）
   - 必须包含：室内/室外、时间段、空间布局、建筑风格
   - 必须包含：主要物件和家具、光线氛围、色调
   - 必须包含：环境细节（墙壁材质、地面、装饰物等）
   - visualPrompt 至少60字

返回 JSON：
{
  "locations": [
    {
      "originalName": "原名",
      "newName": "新名",
      "adjustedDescription": "调整后的中文环境描述",
      "visualPrompt": "至少60字的详细中文生图提示词"
    }
  ]
}`;

  // 分批处理（角色每批5个确保详细输出，场景每批15个）
  const CHAR_BATCH_SIZE = 5;
  const LOC_BATCH_SIZE = 15;

  // 角色批次任务
  const charBatches: Array<{ start: number; batch: typeof mainChars }> = [];
  for (let i = 0; i < mainChars.length; i += CHAR_BATCH_SIZE) {
    charBatches.push({ start: i, batch: mainChars.slice(i, i + CHAR_BATCH_SIZE) });
  }

  const charTasks = charBatches.map(({ start, batch }) => async () => {
    const batchLabel = `角色 ${start + 1}-${Math.min(start + CHAR_BATCH_SIZE, mainChars.length)}/${mainChars.length}`;
    const userContent = `故事标题：${project.novel.originalTitle || project.novel.title}\n角色列表：${JSON.stringify(batch.map(c => ({ name: c.originalName, role: c.role, desc: c.description })))}`;

    const startTime = Date.now();
    const result = await chatCompletionJSON<{ characters?: Array<{ originalName: string; newName: string; adjustedDescription?: string; visualPrompt?: string; costumeDesc?: string }> }>(charSystemPrompt, userContent);
    logLLMCall({ projectId, step: `copyright_chars_${start}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

    if (!result.success || !result.data?.characters) {
      console.log(`[drama] 版权改造 ${batchLabel} 失败: ${result.error}`);
      return;
    }

    for (const t of result.data.characters) {
      const char = project.novel.characters.find(c => c.originalName === t.originalName);
      if (char) {
        char.newName = t.newName;
        if (t.adjustedDescription) char.description = t.adjustedDescription;
        if (t.visualPrompt) char.visualPrompt = t.visualPrompt;
        if (t.costumeDesc) char.costumeDesc = t.costumeDesc;
      }
    }
    console.log(`[drama] 版权改造 ${batchLabel} 完成`);
  });

  // 场景批次任务
  const locBatches: Array<{ start: number; batch: typeof locs }> = [];
  for (let i = 0; i < locs.length; i += LOC_BATCH_SIZE) {
    locBatches.push({ start: i, batch: locs.slice(i, i + LOC_BATCH_SIZE) });
  }

  const locTasks = locBatches.map(({ start, batch }) => async () => {
    const batchLabel = `场景 ${start + 1}-${Math.min(start + LOC_BATCH_SIZE, locs.length)}/${locs.length}`;
    const userContent = `故事标题：${project.novel.originalTitle || project.novel.title}\n场景列表：${JSON.stringify(batch.map(l => ({ name: l.originalName, desc: l.description })))}`;

    const startTime = Date.now();
    const result = await chatCompletionJSON<{ locations?: Array<{ originalName: string; newName: string; adjustedDescription?: string; visualPrompt?: string }> }>(locSystemPrompt, userContent);
    logLLMCall({ projectId, step: `copyright_locs_${start}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

    if (!result.success || !result.data?.locations) {
      console.log(`[drama] 版权改造 ${batchLabel} 失败: ${result.error}`);
      return;
    }

    for (const t of result.data.locations) {
      const loc = project.novel.locations.find(l => l.originalName === t.originalName);
      if (loc) {
        loc.newName = t.newName;
        if (t.adjustedDescription) loc.description = t.adjustedDescription;
        if (t.visualPrompt) {
          loc.visualPrompt = t.visualPrompt;
          // 同步更新 baseVisualPrompt（版权改造后需要重新生成基准 prompt）
          if (loc.baseVisualPrompt) {
            loc.baseVisualPrompt = t.visualPrompt;
          }
        }
      }
    }
    console.log(`[drama] 版权改造 ${batchLabel} 完成`);
  });

  // 角色和场景批次全部并发执行
  const allTasks = [...charTasks, ...locTasks];
  console.log(`[drama] 版权改造并发: ${charTasks.length} 角色批次 + ${locTasks.length} 场景批次`);
  await Promise.all(allTasks.map(fn => fn()));

  // 生成新标题
  const titleResult = await chatCompletionJSON<{ newTitle: string }>(
    '你是一位版权合规专家。请为以下故事生成一个全新的标题（不侵犯原作版权）。返回 JSON：{"newTitle": "新标题"}',
    `原标题：${project.novel.originalTitle || project.novel.title}\n故事梗概：${project.novel.summary.substring(0, 500)}`,
  );
  if (titleResult.success && titleResult.data?.newTitle) {
    project.novel.title = titleResult.data.newTitle;
  }

  updateProject(projectId, { novel: project.novel, status: 'character_confirm' });
  console.log(`[drama] 版权改造完成: ${mainChars.length} 角色 (已跳过 ${project.novel.characters.length - mainChars.length} 个龙套), ${locs.length} 场景`);

  // 更新 EntityGraph 中的名字映射（版权改造后同步）
  if (project.entityGraphData) {
    try {
      const graph = EntityGraph.deserialize(project.entityGraphData);
      const nameMapping: Array<{ originalName: string; newName: string; type: 'character' | 'location' }> = [];
      for (const c of project.novel.characters) {
        if (c.originalName !== c.newName) {
          nameMapping.push({ originalName: c.originalName, newName: c.newName, type: 'character' });
        }
      }
      for (const l of project.novel.locations) {
        if (l.originalName !== l.newName) {
          nameMapping.push({ originalName: l.originalName, newName: l.newName, type: 'location' });
        }
      }
      if (nameMapping.length > 0) {
        graph.renameNodes(nameMapping);
        updateProject(projectId, { entityGraphData: graph.serialize() });
        console.log(`[drama] EntityGraph 名字映射更新: ${nameMapping.length} 个实体`);
      }
    } catch (err) {
      console.error('[drama] EntityGraph 名字映射更新失败:', err);
    }
  }

  return { success: true, project: getProject(projectId) };
}

// 刷新已有项目的 visualPrompt（英文→中文），不影响其他数据
export async function refreshVisualPrompts(projectId: string): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };
  const config = getLLMConfig();

  const charSystemPrompt = `你是一位专业的AI绘画提示词专家。请为以下角色生成详细的中文生图提示词（visualPrompt）。

故事背景：${project.novel.summary || ''}
故事风格：${project.style}

## 严格要求（每个角色的 visualPrompt 必须满足）：
1. 开头必须写明人种/民族（如"中国人"、"东亚面孔"、"黄皮肤黑头发"）
2. 必须包含以下所有维度，缺一不可：
   - 性别和具体年龄（如"17岁少年"而非"青年"）
   - 身高体型（如"身高175cm，偏瘦"）
   - 发型发色（如"黑色短发微卷，刘海遮住额头"）
   - 五官特征（如"单眼皮，高鼻梁，薄嘴唇"）
   - 肤色（如"小麦色皮肤"）
   - 服装（具体款式+颜色，如"蓝白条纹校服外套，内搭白色T恤，深蓝色校裤"）
   - 配饰/道具（如"戴黑框眼镜，左手腕有红绳"）
   - 气质表情（如"眼神锐利带着叛逆，嘴角微微上扬"）
3. visualPrompt 必须至少100字，不足100字视为不合格
4. 不要写"写实电影风格"等风格前缀，只写角色外貌描述

返回 JSON 数组：[{ "id": "角色ID", "visualPrompt": "至少100字的详细中文生图提示词" }]`;

  const locSystemPrompt = `你是一位专业的AI绘画提示词专家。请为以下场景生成详细的中文生图提示词（visualPrompt）。

故事背景：${project.novel.summary || ''}
故事风格：${project.style}

## 严格要求（每个场景的 visualPrompt 必须满足）：
1. 开头必须写明地域文化风格（如"中国南方小城"、"中式校园"）
2. 必须包含以下所有维度：
   - 室内/室外、时间段（白天/夜晚/黄昏）
   - 空间布局和建筑风格
   - 主要物件、家具、装饰
   - 光线氛围和色调
   - 环境细节（墙壁材质、地面、植物等）
3. visualPrompt 必须至少60字
4. 不要写"写实电影风格"等风格前缀，只写场景描述

返回 JSON 数组：[{ "id": "场景ID", "visualPrompt": "至少60字的详细中文生图提示词" }]`;

  // 分批处理角色（每批5个，确保每个角色有足够的输出空间）
  const CHAR_BATCH = 5;
  const mainChars = project.novel.characters.filter(c => c.role !== 'minor');
  const charTasks = [];
  for (let i = 0; i < mainChars.length; i += CHAR_BATCH) {
    const batch = mainChars.slice(i, i + CHAR_BATCH);
    charTasks.push((async () => {
      const input = JSON.stringify(batch.map(c => ({ id: c.id, name: c.newName, description: c.description, personality: c.personality })));
      const st = Date.now();
      const r = await chatCompletionJSON<Array<{ id: string; visualPrompt: string }>>(charSystemPrompt, input);
      logLLMCall({ projectId, step: `refresh_chars_${i}`, provider: config.provider, model: config.model, durationMs: Date.now() - st, success: r.success, error: r.error });
      return r.success && r.data ? (Array.isArray(r.data) ? r.data : []) : [];
    })());
  }

  // 分批处理场景（每批15个）
  const LOC_BATCH = 15;
  const locTasks = [];
  for (let i = 0; i < project.novel.locations.length; i += LOC_BATCH) {
    const batch = project.novel.locations.slice(i, i + LOC_BATCH);
    locTasks.push((async () => {
      const input = JSON.stringify(batch.map(l => ({ id: l.id, name: l.newName, description: l.description })));
      const st = Date.now();
      const r = await chatCompletionJSON<Array<{ id: string; visualPrompt: string }>>(locSystemPrompt, input);
      logLLMCall({ projectId, step: `refresh_locs_${i}`, provider: config.provider, model: config.model, durationMs: Date.now() - st, success: r.success, error: r.error });
      return r.success && r.data ? (Array.isArray(r.data) ? r.data : []) : [];
    })());
  }

  // 角色和场景并发执行
  const [charResults, locResults] = await Promise.all([
    Promise.all(charTasks),
    Promise.all(locTasks),
  ]);

  const charItems = charResults.flat();
  const locItems = locResults.flat();

  let charUpdated = 0, locUpdated = 0;
  for (const item of charItems) {
    const char = project.novel.characters.find(c => c.id === item.id);
    if (char && item.visualPrompt) {
      char.visualPrompt = item.visualPrompt;
      char.confirmed = false;
      char.imageUrls = [];
      charUpdated++;
    }
  }
  for (const item of locItems) {
    const loc = project.novel.locations.find(l => l.id === item.id);
    if (loc && item.visualPrompt) {
      loc.visualPrompt = item.visualPrompt;
      // 同步更新 baseVisualPrompt，保证基准 prompt 与最新 visualPrompt 一致
      loc.baseVisualPrompt = item.visualPrompt;
      loc.imageUrl = undefined;
      loc.imageUrls = undefined;
      locUpdated++;
    }
  }

  updateProject(projectId, { novel: project.novel, status: 'character_confirm' });
  console.log(`[drama] visualPrompt 已刷新: ${charUpdated} 角色, ${locUpdated} 场景`);
  return { success: true };
}

// 重新生成标题和摘要
export async function refreshTitleAndSummary(projectId: string): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };
  const config = getLLMConfig();

  const mainChars = project.novel.characters.filter(c => c.role !== 'minor').slice(0, 10);
  const charNames = mainChars.map(c => c.newName).join('、');

  const summaryPrompt = `你是一位专业编剧。根据以下角色、场景和情节信息，为这个故事生成标题和摘要。

严格要求：
- 必须使用以下角色名字，不得更改或编造新名字：${charNames}
- title：不超过10个字，要有吸引力
- summary：300字以内，使用上述角色名字，包含核心冲突、发展脉络和结局走向，语言流畅连贯

返回 JSON：{ "title": "故事标题", "summary": "300字以内完整梗概" }`;

  const input = JSON.stringify({
    characters: mainChars.map(c => ({ name: c.newName, role: c.role, desc: c.description })),
    locations: project.novel.locations.slice(0, 10).map(l => ({ name: l.newName, desc: l.description })),
    themes: project.novel.themes,
    plotPoints: project.novel.plotPoints?.slice(0, 15).map(p => p.summary),
  });

  const st = Date.now();
  const result = await chatCompletionJSON<{ title?: string; summary?: string }>(summaryPrompt, input);
  logLLMCall({ projectId, step: 'refresh_title_summary', provider: config.provider, model: config.model, durationMs: Date.now() - st, success: result.success, error: result.error });

  if (!result.success || !result.data) return { success: false, error: result.error || '生成失败' };
  if (result.data.title) project.novel.title = result.data.title;
  if (result.data.summary) project.novel.summary = result.data.summary;
  updateProject(projectId, { novel: project.novel });
  console.log(`[drama] 标题和摘要已刷新: ${result.data.title}`);
  return { success: true };
}


// 第3步：生成分镜脚本 - 集成阶段1（Seedance 时间轴格式）+ 阶段2（创意四关审核）
export async function generateScript(projectId: string, onProgress?: (msg: string) => void): Promise<{ success: boolean; project?: DramaProject; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const actsDistribution = distributeEpisodes(project.targetEpisodes);
  const total = project.targetEpisodes;
  const dur = project.episodeDuration;

  // 构建角色和场景上下文（含服化道和档案图引用）
  const mainChars = project.novel.characters.filter(c => c.role !== 'minor');
  const storyContext = `故事：${project.novel.summary}
风格：${project.style}

## 角色档案（全剧外貌/服化道/道具必须统一，用ID引用）
${mainChars.map(c => {
  const parts = [`- ${c.newName}(${c.id}): ${c.description}，${c.personality}`];
  if (c.costumeDesc) parts.push(`  服化道：${c.costumeDesc}`);
  if (c.profileImages?.main) parts.push(`  档案主图：@${c.id}_主图`);
  if (c.profileImages?.front) parts.push(`  正面图：@${c.id}_正面`);
  if (c.profileImages?.side) parts.push(`  侧面图：@${c.id}_侧面`);
  if (c.profileImages?.back) parts.push(`  背面图：@${c.id}_背面`);
  if (c.profileImages?.costume) parts.push(`  服装图：@${c.id}_服装`);
  return parts.join('\n');
}).join('\n')}

## 场景（同场景视觉统一，用ID引用）
${buildSpatialContext(project.novel.locations, project.novel.spatialMap)}

${project.entityGraphData ? (() => { try { return EntityGraph.deserialize(project.entityGraphData).buildRelationContext(); } catch { return ''; } })() : ''}

## 一致性铁律（不可违反）
1. 角色外貌：每次出场必须完整描述外貌特征（发型、肤色、体型），不可省略
2. 服化道锁定：角色默认服装/配饰/道具在全剧中固定不变，换装必须在对白或旁白中说明原因
3. 道具连续性：角色的标志性道具（眼镜、手链、书包等）每次出场必须携带，不可遗漏
4. 场景锁定：同一场景ID的空间布局、家具、色调在所有集中完全一致，只有人物和活动不同
5. 场景变体：同一物理空间的不同状态（如"教室-上课"vs"教室-空教室"）使用同一场景ID
6. 空间逻辑：从A看向B的视角必须与从B看向A一致（教室窗外是操场→操场能看到教学楼）
7. 引用规范：用角色ID(C01)和场景ID(S01)引用，不可用自由文本替代

情节：
${project.novel.plotPoints.map(p => `第${p.chapter}章 [${p.emotionalTone}]: ${p.summary}｜${(p.keyEvents || []).join('、')}`).join('\n')}
主题：${project.novel.themes.join('、')}`;

  // 计算分镜参数
  const MAX_SHOT_DURATION = 15; // Seedance 单次最长 15 秒
  const shotsPerEp = Math.ceil(dur / MAX_SHOT_DURATION);
  const lastShotDuration = dur % MAX_SHOT_DURATION || MAX_SHOT_DURATION;

  // 构建分镜时间轴模板（每个 shot 内部的时间轴）
  const buildShotTimeTemplate = (shotDuration: number) => {
    const slots: string[] = [];
    for (let t = 0; t < shotDuration; t += 3) {
      const end = Math.min(t + 3, shotDuration);
      slots.push(`${t}-${end}s画面：[景别+运镜]，[画面描述，包含角色外貌和服化道]`);
    }
    return slots.join('\n');
  };

  // 根据模型输出能力决定每批生成多少集
  // 分镜模式下每集输出更多，按 shotsPerEp * 400 token 估算
  const config = getLLMConfig();
  const outputTokens = config.maxTokens || 8000;
  const tokensPerEp = shotsPerEp * 400;
  const epsPerBatch = Math.max(1, Math.floor(outputTokens / tokensPerEp));
  const batches: Array<{ from: number; to: number; act: string }> = [];

  // 按四幕分配集数范围
  const actRanges = [
    { from: 1, to: actsDistribution[0], act: '起' },
    { from: actsDistribution[0] + 1, to: actsDistribution[0] + actsDistribution[1], act: '承' },
    { from: actsDistribution[0] + actsDistribution[1] + 1, to: actsDistribution[0] + actsDistribution[1] + actsDistribution[2], act: '转' },
    { from: actsDistribution[0] + actsDistribution[1] + actsDistribution[2] + 1, to: total, act: '合' },
  ];

  if (total <= epsPerBatch) {
    // 集数少，一次生成
    batches.push({ from: 1, to: total, act: '全部' });
  } else {
    // 按四幕拆批，每幕内再按 epsPerBatch 细分
    for (const range of actRanges) {
      if (range.from > range.to) continue;
      for (let start = range.from; start <= range.to; start += epsPerBatch) {
        const end = Math.min(start + epsPerBatch - 1, range.to);
        batches.push({ from: start, to: end, act: range.act });
      }
    }
  }

  console.log(`[drama] 脚本生成: ${total} 集, 每集 ${dur}s = ${shotsPerEp} 个分镜, 分 ${batches.length} 批 (每批约 ${epsPerBatch} 集)`);
  onProgress?.(`脚本生成: ${total} 集 (每集 ${shotsPerEp} 个分镜), 分 ${batches.length} 批`);

  // 构建分镜示例（结构化输出，含对白/动作/镜头角度）
  const shotExampleFirst = `      { "index": 1, "startTime": 0, "endTime": ${Math.min(MAX_SHOT_DURATION, dur)}, "prompt": "${project.style}，${project.ratio}，[氛围]\\n${buildShotTimeTemplate(Math.min(MAX_SHOT_DURATION, dur))}\\n【参考】@C01_主图 @S01", "dialogue": "角色对白或旁白文本（无则留空）", "action": "角色动作描述", "cameraAngle": "景别+运镜，如：近景，缓慢推镜头", "soundDesign": "配乐风格+音效描述", "characterRefs": ["C01"], "locationRefs": ["S01"], "transition": "转场方式" }`;
  const lastStart = (shotsPerEp - 1) * MAX_SHOT_DURATION;
  const shotExampleLast = shotsPerEp > 1
    ? `,\n      { "index": ${shotsPerEp}, "startTime": ${lastStart}, "endTime": ${lastStart + lastShotDuration}, "prompt": "...(同格式)", "dialogue": "...", "action": "...", "cameraAngle": "...", "soundDesign": "...", "characterRefs": ["C02"], "locationRefs": ["S02"], "transition": "" }`
    : '';
  const shotExample = shotExampleFirst + (shotsPerEp > 2 ? ',\n      "... 中间分镜省略，共 ' + shotsPerEp + ' 个"' : '') + shotExampleLast;

  const buildScriptSystemPrompt = (batchFrom: number, batchTo: number, batchAct: string, prevEndingFrame?: string) => {
    let prompt = `你是一位专业的短剧编剧兼视频创意总监。请生成第 ${batchFrom}-${batchTo} 集的分镜脚本。

## 关键参数
- 每集总时长：${dur} 秒
- 每集分镜数：${shotsPerEp} 个（每个分镜最长 ${MAX_SHOT_DURATION} 秒，最后一个分镜 ${lastShotDuration} 秒）
- 视频生成引擎每次只能生成最长 ${MAX_SHOT_DURATION} 秒视频，所以必须拆分为多个分镜

## 全剧四幕结构（起承转合）共 ${total} 集
- 起（第1幕）：第 1-${actsDistribution[0]} 集 — 人物介绍、世界观建立、事件起因
- 承（第2幕）：第 ${actsDistribution[0] + 1}-${actsDistribution[0] + actsDistribution[1]} 集 — 情节发展、矛盾升级、试炼之路
- 转（第3幕）：第 ${actsDistribution[0] + actsDistribution[1] + 1}-${actsDistribution[0] + actsDistribution[1] + actsDistribution[2]} 集 — 高潮、转折、最终对决
- 合（第4幕）：第 ${actsDistribution[0] + actsDistribution[1] + actsDistribution[2] + 1}-${total} 集 — 结局、主题升华

当前批次属于【${batchAct}】阶段。

## 分镜 prompt 格式（每个 shot 的 prompt 必须独立完整，用于视频生成）
每个分镜的 prompt 只包含画面描述，格式：

${project.style}，${project.ratio}，[该分镜的氛围]

[时间轴画面描述，每3秒一段，必须包含角色完整外貌和服化道]

【参考】@角色ID_主图 @场景ID [用途说明]

对白、动作、镜头角度、声音设计分别放在独立字段中（见输出格式）。

## 分镜结构化字段说明
- prompt：纯画面描述（用于视频生成引擎），必须包含角色外貌和服化道
- dialogue：该分镜的对白或旁白文本（用于字幕和配音），无对白则留空字符串
- action：角色动作描述（如"转身离开"、"低头翻书"），简洁明确
- cameraAngle：景别+运镜（如"近景，缓慢推镜头"），必须从运镜词库选取
- soundDesign：配乐风格+音效（如"钢琴轻柔旋律，翻书声，远处铃声"）

## 分镜拆分原则
1. 每个分镜是一个独立的视频片段，prompt 必须自包含（不依赖其他分镜的上下文）
2. 每个分镜的画面描述中必须包含角色的完整外貌和服化道描述（因为每个分镜独立生成）
3. 分镜之间通过 transition 字段指定转场方式
4. 同一场景内的连续分镜，后一个分镜开头要与前一个分镜结尾画面衔接
5. 场景切换时，transition 要明确标注转场类型
6. 每个分镜必须有明确的对白或旁白（dialogue 字段），推动剧情发展

## 运镜词库（cameraAngle 必须从以下选取组合）
景别：大远景、远景、全景、中景、近景、特写、大特写
运镜：推镜头、拉镜头、摇镜头、移镜头、跟拍、环绕拍摄、航拍、手持跟拍、希区柯克变焦
角度：平视、俯拍、仰拍、低角度、鸟瞰视角、第一人称视角
节奏：慢动作、快切、延时摄影、一镜到底、升格拍摄
转场：硬切、淡入淡出、遮挡擦镜转场、无缝渐变转场、闪白、闪黑、叠化

## 创意四关自审
1. 记忆点：观众看完能记住什么？
2. 意外感：是否有反转、对比、夸张？
3. 情绪弧线：${dur} 秒内有没有情绪变化？
4. 叙事变化：有清晰的从A到B的变化

## 集与集衔接
- 每集最后一个分镜的最后一帧作为 endingFrame
- 下一集第一个分镜开头要与上一集 endingFrame 自然衔接`;

    if (prevEndingFrame) {
      prompt += `\n\n## 上一集结尾画面（必须衔接）\n${prevEndingFrame}`;
    }

    prompt += `\n\n## 输出格式
返回 JSON 数组（只包含第 ${batchFrom}-${batchTo} 集）：
[
  {
    "number": ${batchFrom},
    "title": "集标题",
    "act": "起/承/转/合",
    "emotionalTone": "情感基调",
    "shots": [
${shotExample}
    ],
    "characterRefs": ["C01", "C02"],
    "locationRefs": ["S01"],
    "endingFrame": "最后一个分镜最后一帧的详细画面描述"
  }
]

重要：每个 shot 必须包含 dialogue、action、cameraAngle、soundDesign 四个结构化字段，不可省略。`;
    return prompt;
  };

  // 按四幕分组：同一幕内并发，幕间串行（传递 endingFrame 衔接）
  const actGroups: Map<string, Array<{ from: number; to: number; act: string; idx: number }>> = new Map();
  const actOrder: string[] = [];
  batches.forEach((b, idx) => {
    if (!actGroups.has(b.act)) {
      actGroups.set(b.act, []);
      actOrder.push(b.act);
    }
    actGroups.get(b.act)!.push({ ...b, idx: idx + 1 });
  });

  const allEpisodes: EpisodeScript[] = [];
  let prevEndingFrame: string | undefined;
  let completedBatches = 0;
  const SCRIPT_CONCURRENCY = 2; // LLM 并发数，避免速率限制

  for (const act of actOrder) {
    const actBatches = actGroups.get(act)!;

    // 单批执行逻辑
    const runBatch = async (batch: typeof actBatches[0]) => {
      const isFirstInAct = batch === actBatches[0];
      const systemPrompt = buildScriptSystemPrompt(batch.from, batch.to, batch.act, isFirstInAct ? prevEndingFrame : undefined);

      console.log(`[drama] 脚本批次 ${batch.idx}/${batches.length} 开始: 第 ${batch.from}-${batch.to} 集 (${batch.act})`);
      onProgress?.(`脚本批次 ${batch.idx}/${batches.length} 请求中: 第 ${batch.from}-${batch.to} 集...`);

      // 带重试的 LLM 调用（最多 2 次）
      let result: { success: boolean; data?: EpisodeScript[]; error?: string; raw?: string } | null = null;
      let durationMs = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          console.log(`[drama] 脚本批次 ${batch.idx} 重试 (第 ${attempt + 1} 次)`);
          onProgress?.(`脚本批次 ${batch.idx} 重试中...`);
        }
        const startTime = Date.now();
        result = await chatCompletionJSON<EpisodeScript[]>(systemPrompt, storyContext, { timeoutMs: 300000 });
        durationMs = Date.now() - startTime;
        if (result.success && result.data) break;
        console.log(`[drama] 脚本批次 ${batch.idx} 第 ${attempt + 1} 次失败 (${(durationMs / 1000).toFixed(1)}s): ${result.error}`);
      }

      logLLMCall({ projectId, step: `script_batch_${batch.idx}`, provider: config.provider, model: config.model, durationMs, success: result!.success, error: result!.error });

      completedBatches++;
      console.log(`[drama] 脚本批次 ${batch.idx}/${batches.length} 完成 (${(durationMs / 1000).toFixed(1)}s): 第 ${batch.from}-${batch.to} 集`);
      onProgress?.(`脚本批次 ${completedBatches}/${batches.length} 完成`);

      return { batch, result: result!, durationMs };
    };

    // 带并发限制执行同一幕的批次
    const actResults: Array<{ batch: typeof actBatches[0]; result: { success: boolean; data?: EpisodeScript[]; error?: string; raw?: string }; durationMs: number }> = [];
    for (let i = 0; i < actBatches.length; i += SCRIPT_CONCURRENCY) {
      const chunk = actBatches.slice(i, i + SCRIPT_CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(runBatch));
      actResults.push(...chunkResults);
    }

    // 按集号排序合并结果
    actResults.sort((a, b) => a.batch.from - b.batch.from);

    for (const { batch, result } of actResults) {
      if (!result.success || !result.data) {
        console.log(`[drama] 脚本批次 ${batch.idx}/${batches.length} 失败，跳过 (后续补生成): ${result.error}`);
        continue;
      }

      const batchEpisodes = Array.isArray(result.data) ? result.data : [];
      for (const ep of batchEpisodes) {
        if (!ep.shots) ep.shots = [];
        ep.prompt = ep.shots.map(s => `[分镜${s.index} ${s.startTime}-${s.endTime}s]\n${s.prompt}`).join('\n\n');
      }
      allEpisodes.push(...batchEpisodes);

      // 记录本幕最后一集的 endingFrame 供下一幕衔接
      if (batchEpisodes.length > 0) {
        prevEndingFrame = batchEpisodes[batchEpisodes.length - 1].endingFrame;
      }
    }

    console.log(`[drama] 【${act}】阶段完成: ${actBatches.length} 批并发, 共 ${actResults.reduce((s, r) => s + (Array.isArray(r.result.data) ? r.result.data.length : 0), 0)} 集`);
  }

  // 校验集数完整性：检查是否有缺失的集号
  const existingNumbers = new Set(allEpisodes.map(ep => ep.number));
  const missingNumbers: number[] = [];
  for (let n = 1; n <= total; n++) {
    if (!existingNumbers.has(n)) missingNumbers.push(n);
  }

  if (missingNumbers.length > 0) {
    console.log(`[drama] 检测到缺失集: ${missingNumbers.join(', ')}，补生成中...`);
    onProgress?.(`补生成缺失的 ${missingNumbers.length} 集: ${missingNumbers.join(', ')}`);

    // 逐集补生成
    for (const num of missingNumbers) {
      const prevEp = allEpisodes.find(e => e.number === num - 1);
      const actRange = actRanges.find(r => num >= r.from && num <= r.to);
      const act = actRange?.act || '承';
      const systemPrompt = buildScriptSystemPrompt(num, num, act, prevEp?.endingFrame);

      const result = await chatCompletionJSON<EpisodeScript[]>(systemPrompt, storyContext, { timeoutMs: 300000 });
      if (result.success && result.data) {
        const eps = Array.isArray(result.data) ? result.data : [];
        for (const ep of eps) {
          if (!ep.shots) ep.shots = [];
          ep.prompt = ep.shots.map(s => `[分镜${s.index} ${s.startTime}-${s.endTime}s]\n${s.prompt}`).join('\n\n');
        }
        allEpisodes.push(...eps);
        console.log(`[drama] 补生成第 ${num} 集完成`);
      } else {
        console.log(`[drama] 补生成第 ${num} 集失败: ${result.error}`);
      }
    }
  }

  // 按集号排序
  allEpisodes.sort((a, b) => a.number - b.number);

  // 去重（同一集号保留最后一个）
  const deduped: EpisodeScript[] = [];
  const seen = new Set<number>();
  for (let i = allEpisodes.length - 1; i >= 0; i--) {
    if (!seen.has(allEpisodes[i].number)) {
      seen.add(allEpisodes[i].number);
      deduped.unshift(allEpisodes[i]);
    }
  }

  console.log(`[drama] 脚本生成完成: 目标 ${total} 集, 实际 ${deduped.length} 集`);
  updateProject(projectId, { episodes: deduped, status: 'ready' });
  onProgress?.(`脚本生成完成: ${deduped.length} 集`);

  return { success: true, project: getProject(projectId) };
}

// 创意优化：逐集优化，并发处理，支持进度回调
const OPTIMIZE_SINGLE_PROMPT = `你是视频创意总监。请对以下单集分镜脚本进行创意四关审核和优化。

## 创意四关审核标准（严格评分，禁止虚高）
1. **记忆点**(0-3分)：有让人过目不忘的画面/台词=3分，有亮点但不够震撼=2分，一般=1分，没有=0分
2. **意外感**(0-3分)：有出人意料的反转/对比=3分，有小巧思=2分，有轻微变化=1分，全是套路=0分
3. **情绪弧线**(0-2分)：有明显情绪起伏和转折=2分，有轻微变化=1分，平淡=0分
4. **叙事变化**(0-2分)：有清晰的从A到B的变化=2分，有变化但不明显=1分，静态展示=0分

⚠ 评分规则：
- 满分10分极其罕见，只有真正惊艳的作品才配得上
- 大多数脚本应该在 5-7 分之间
- 如果你给出 8 分以上，必须在 notes 中详细说明每项为什么值这个分数
- 先优化再打分，打分基于优化后的版本
- 5分以下的必须大幅重写

## 优化手段
- 选择更有表现力的运镜（如：普通推镜头→希区柯克变焦）
- 增加情绪对比和视觉冲突
- 优化时间轴节奏分配（重点画面给更多时间）
- 加入声音设计细节（环境音、音效先行、ASMR质感等）

## 集间衔接要求（极其重要）
- 如果提供了"上一集结尾画面"，本集开头必须与之自然衔接（画面、情绪、节奏平滑过渡）
- 如果提供了"下一集开头画面"，本集结尾必须为其做好铺垫
- endingFrame 必须精确描述最后一帧，作为下一集的衔接锚点
- 转场不能生硬跳切，优先使用：情绪延续、视觉呼应、声音桥接等手法

## 服化道一致性（不可破坏）
- 优化时不得随意更改角色的服装、妆容、道具描述
- 如果原脚本中角色穿的是默认服装，优化后必须保持一致
- 如果原脚本中有换装描述和原因，优化后必须保留
- 标志性道具（手链、眼镜、绷带等）不可遗漏

返回 JSON：
{
  "number": 集号,
  "title": "优化后标题",
  "act": "起/承/转/合",
  "emotionalTone": "情感基调",
  "shots": [{"index": 1, "startTime": 0, "endTime": 15, "prompt": "优化后的分镜提示词", "characterRefs": ["C01"], "locationRefs": ["S01"], "transition": "转场方式"}],
  "characterRefs": ["C01"],
  "locationRefs": ["S01"],
  "endingFrame": "最后一帧画面描述",
  "score": 总分(0-10整数),
  "scoreDetail": {"记忆点": 0-3, "意外感": 0-3, "情绪弧线": 0-2, "叙事变化": 0-2},
  "notes": "各项扣分原因和优化说明"
}
注意：如果输入有 shots 数组，必须逐分镜优化并返回 shots；如果输入只有 prompt，返回优化后的 prompt 即可。`;

// 构建角色服化道上下文（供优化和生成时复用）
function buildCostumeContext(characters: CharacterInfo[]): string {
  const mainChars = characters.filter(c => c.role !== 'minor' && c.costumeDesc);
  if (mainChars.length === 0) return '';
  return '\n\n角色服化道设定（全剧基准）：\n' + mainChars.map(c =>
    `- ${c.newName}(${c.id}): ${c.costumeDesc}`
  ).join('\n');
}

export async function optimizeScripts(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project || project.episodes.length === 0) return { success: false, error: '无脚本可优化' };

  const config = getLLMConfig();
  const total = project.episodes.length;
  const CONCURRENCY = 5;
  let doneCount = 0;

  console.log(`[drama] 创意优化: ${total} 集, 并发 ${CONCURRENCY}`);
  onProgress?.(`创意优化: ${total} 集, 并发 ${CONCURRENCY}`);

  const optimizedEpisodes = [...project.episodes]; // 拷贝，逐集替换
  const scores: number[] = [];

  // 优化单集（带上下集衔接上下文）
  const optimizeOne = async (index: number): Promise<void> => {
    const ep = project.episodes[index];
    const prevEp = index > 0 ? project.episodes[index - 1] : null;
    const nextEp = index < project.episodes.length - 1 ? project.episodes[index + 1] : null;

    let userContent = `风格：${project.style}${buildCostumeContext(project.novel.characters)}`;
    // 加入 EntityGraph 关系上下文
    if (project.entityGraphData) {
      try {
        const graphCtx = EntityGraph.deserialize(project.entityGraphData).buildRelationContext();
        if (graphCtx) userContent += `\n\n${graphCtx}`;
      } catch { /* ignore */ }
    }
    userContent += `\n当前脚本：\n${JSON.stringify(ep, null, 2)}`;
    if (prevEp?.endingFrame) {
      userContent += `\n\n上一集(E${String(prevEp.number).padStart(2, '0')})结尾画面：${prevEp.endingFrame}`;
    }
    if (nextEp) {
      const nextOpening = nextEp.prompt.split('\n').find(l => l.match(/^0-\d+s/)) || nextEp.prompt.split('\n')[2] || '';
      userContent += `\n\n下一集(E${String(nextEp.number).padStart(2, '0')})开头画面：${nextOpening}`;
    }

    const startTime = Date.now();
    const result = await chatCompletionJSON<Record<string, unknown>>(OPTIMIZE_SINGLE_PROMPT, userContent);
    logLLMCall({ projectId, step: `optimize_ep_${ep.number}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

    if (result.success && result.data) {
      const d = result.data;
      // 用优化结果替换，保留原始字段作为 fallback
      optimizedEpisodes[index] = {
        number: (d.number as number) || ep.number,
        title: (d.title as string) || ep.title,
        act: (d.act as string) || ep.act,
        emotionalTone: (d.emotionalTone as string) || ep.emotionalTone,
        prompt: (d.prompt as string) || ep.prompt,
        shots: (d.shots as Shot[]) || ep.shots, // 保留分镜
        characterRefs: (d.characterRefs as string[]) || ep.characterRefs,
        locationRefs: (d.locationRefs as string[]) || ep.locationRefs,
        endingFrame: (d.endingFrame as string) || ep.endingFrame,
        score: typeof d.score === 'number' ? d.score : undefined,
      };
      // 如果优化返回了 shots，同步更新 prompt 用于显示
      if (d.shots && Array.isArray(d.shots) && (d.shots as Shot[]).length > 0) {
        optimizedEpisodes[index].prompt = (d.shots as Shot[]).map(s =>
          `[分镜${s.index} ${s.startTime}-${s.endTime}s]\n${s.prompt}`
        ).join('\n\n');
      }
      if (typeof d.score === 'number') scores.push(d.score);
      console.log(`[drama] 优化第 ${ep.number} 集完成 (评分: ${d.score || 'N/A'})`);
    } else {
      // 失败保留原始
      console.log(`[drama] 优化第 ${ep.number} 集失败: ${result.error}`);
    }

    doneCount++;
    onProgress?.(`创意优化: ${doneCount}/${total} 集完成`);
  };

  // 并发控制：每次最多 CONCURRENCY 个
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, total); j++) {
      batch.push(optimizeOne(j));
    }
    await Promise.allSettled(batch);
  }

  // 保存优化结果
  updateProject(projectId, { episodes: optimizedEpisodes });
  const avgScore = scores.length > 0 ? (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1) : 'N/A';
  console.log(`[drama] 创意优化完成: ${total} 集，平均评分 ${avgScore}`);
  onProgress?.(`创意优化完成: ${total} 集，平均评分 ${avgScore}`);

  return { success: true };
}

// 单集创意优化
export async function optimizeSingleEpisode(
  projectId: string,
  episodeNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const epIndex = project.episodes.findIndex(e => e.number === episodeNumber);
  if (epIndex < 0) return { success: false, error: '集数不存在' };

  const ep = project.episodes[epIndex];
  const config = getLLMConfig();
  const prevEp = epIndex > 0 ? project.episodes[epIndex - 1] : null;
  const nextEp = epIndex < project.episodes.length - 1 ? project.episodes[epIndex + 1] : null;

  let userContent = `风格：${project.style}${buildCostumeContext(project.novel.characters)}`;
  // 加入 EntityGraph 关系上下文
  if (project.entityGraphData) {
    try {
      const graphCtx = EntityGraph.deserialize(project.entityGraphData).buildRelationContext();
      if (graphCtx) userContent += `\n\n${graphCtx}`;
    } catch { /* ignore */ }
  }
  userContent += `\n当前脚本：\n${JSON.stringify(ep, null, 2)}`;
  if (prevEp?.endingFrame) {
    userContent += `\n\n上一集(E${String(prevEp.number).padStart(2, '0')})结尾画面：${prevEp.endingFrame}`;
  }
  if (nextEp) {
    const nextOpening = nextEp.prompt.split('\n').find(l => l.match(/^0-\d+s/)) || nextEp.prompt.split('\n')[2] || '';
    userContent += `\n\n下一集(E${String(nextEp.number).padStart(2, '0')})开头画面：${nextOpening}`;
  }

  const startTime = Date.now();
  const result = await chatCompletionJSON<Record<string, unknown>>(OPTIMIZE_SINGLE_PROMPT, userContent);
  logLLMCall({ projectId, step: `optimize_ep_${ep.number}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

  if (!result.success || !result.data) {
    return { success: false, error: result.error || '优化失败' };
  }

  const d = result.data;
  project.episodes[epIndex] = {
    ...ep, // 保留 refImageUrls、videoUrl 等字段
    number: (d.number as number) || ep.number,
    title: (d.title as string) || ep.title,
    act: (d.act as string) || ep.act,
    emotionalTone: (d.emotionalTone as string) || ep.emotionalTone,
    prompt: (d.prompt as string) || ep.prompt,
    shots: (d.shots as Shot[]) || ep.shots,
    characterRefs: (d.characterRefs as string[]) || ep.characterRefs,
    locationRefs: (d.locationRefs as string[]) || ep.locationRefs,
    endingFrame: (d.endingFrame as string) || ep.endingFrame,
    score: typeof d.score === 'number' ? d.score : undefined,
  };
  // 如果优化返回了 shots，同步更新 prompt
  if (d.shots && Array.isArray(d.shots) && (d.shots as Shot[]).length > 0) {
    project.episodes[epIndex].prompt = (d.shots as Shot[]).map(s =>
      `[分镜${s.index} ${s.startTime}-${s.endTime}s]\n${s.prompt}`
    ).join('\n\n');
  }

  updateProject(projectId, { episodes: project.episodes });
  console.log(`[drama] 单集优化完成: 第 ${episodeNumber} 集 (评分: ${d.score || 'N/A'})`);
  return { success: true };
}

// 单集分镜重新生成（保留集的标题/幕/情感基调，只重新生成 shots）
export async function regenerateEpisodeShots(
  projectId: string,
  episodeNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const epIndex = project.episodes.findIndex(e => e.number === episodeNumber);
  if (epIndex < 0) return { success: false, error: '集数不存在' };

  const ep = project.episodes[epIndex];
  const dur = project.episodeDuration;
  const total = project.targetEpisodes;
  const MAX_SHOT_DURATION = 15;
  const shotsPerEp = Math.ceil(dur / MAX_SHOT_DURATION);
  const lastShotDuration = dur % MAX_SHOT_DURATION || MAX_SHOT_DURATION;
  const actsDistribution = distributeEpisodes(total);

  // 上下集衔接上下文
  const prevEp = epIndex > 0 ? project.episodes[epIndex - 1] : null;
  const nextEp = epIndex < project.episodes.length - 1 ? project.episodes[epIndex + 1] : null;

  // 构建角色/场景上下文（复用 generateScript 的格式）
  let graphRelationCtx = '';
  if (project.entityGraphData) {
    try {
      graphRelationCtx = EntityGraph.deserialize(project.entityGraphData).buildRelationContext();
    } catch { /* ignore */ }
  }
  const storyContext = `故事：${project.novel.summary}
风格：${project.style}
${buildCostumeContext(project.novel.characters)}

角色：
${project.novel.characters.filter(c => c.role !== 'minor').map(c =>
    `- ${c.newName}(${c.id}): 外貌=${c.description}${c.costumeDesc ? `，服化道=${c.costumeDesc}` : ''}`
  ).join('\n')}

场景：
${project.novel.locations.map(l => `- ${l.newName}(${l.id}): ${l.description}`).join('\n')}
${graphRelationCtx ? `\n${graphRelationCtx}` : ''}
本集信息：第 ${ep.number} 集「${ep.title}」(${ep.act}) 情感基调=${ep.emotionalTone}
角色出场：${ep.characterRefs.join(', ')}
场景使用：${ep.locationRefs.join(', ')}`;

  let systemPrompt = `你是一位专业的短剧编剧兼视频创意总监。请为第 ${ep.number} 集重新生成分镜列表。

## 关键参数
- 每集总时长：${dur} 秒
- 分镜数：${shotsPerEp} 个（每个最长 ${MAX_SHOT_DURATION} 秒，最后一个 ${lastShotDuration} 秒）

## 分镜要求
1. 每个分镜的 prompt 必须独立完整（包含角色外貌、服化道、场景描述）
2. 分镜之间通过 transition 指定转场方式
3. characterRefs 和 locationRefs 必须使用角色ID和场景ID（如 C01、S01）
4. 每个分镜的画面描述按每3秒一段

## 运镜词库
景别：大远景、远景、全景、中景、近景、特写、大特写
运镜：推镜头、拉镜头、摇镜头、移镜头、跟拍、环绕拍摄、航拍、手持跟拍
转场：硬切、淡入淡出、遮挡擦镜转场、无缝渐变转场、闪白、闪黑、叠化`;

  if (prevEp?.endingFrame) {
    systemPrompt += `\n\n## 上一集结尾画面（必须衔接）\n${prevEp.endingFrame}`;
  }
  if (nextEp?.shots?.[0]?.prompt) {
    systemPrompt += `\n\n## 下一集开头分镜（必须铺垫）\n${nextEp.shots[0].prompt.split('\n')[0]}`;
  }

  systemPrompt += `\n\n## 输出格式
返回 JSON：
{
  "shots": [
    { "index": 1, "startTime": 0, "endTime": ${MAX_SHOT_DURATION}, "prompt": "完整的视频生成提示词", "characterRefs": ["C01"], "locationRefs": ["S01"], "transition": "转场方式" }
  ],
  "endingFrame": "最后一帧画面描述"
}`;

  const config = getLLMConfig();
  const startTime = Date.now();
  const result = await chatCompletionJSON<{ shots?: Shot[]; endingFrame?: string }>(systemPrompt, storyContext);
  logLLMCall({ projectId, step: `regen_shots_ep_${ep.number}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

  if (!result.success || !result.data?.shots || result.data.shots.length === 0) {
    return { success: false, error: result.error || '分镜生成失败' };
  }

  // 更新分镜，保留原有的 refImageUrls、videoUrl 等状态
  const newShots = result.data.shots;
  project.episodes[epIndex].shots = newShots;
  project.episodes[epIndex].prompt = newShots.map(s =>
    `[分镜${s.index} ${s.startTime}-${s.endTime}s]\n${s.prompt}`
  ).join('\n\n');
  if (result.data.endingFrame) {
    project.episodes[epIndex].endingFrame = result.data.endingFrame;
  }
  // 清除旧的视频状态（分镜变了，视频需要重新生成）
  project.episodes[epIndex].videoUrl = undefined;
  project.episodes[epIndex].videoStatus = undefined;
  project.episodes[epIndex].videoError = undefined;

  updateProject(projectId, { episodes: project.episodes });
  console.log(`[drama] 单集分镜重新生成完成: 第 ${ep.number} 集 (${newShots.length} 个分镜)`);
  return { success: true };
}

// 角色确认（更新角色图和确认状态）
export function confirmCharacter(projectId: string, characterId: string, imageUrls?: string[]): { success: boolean; allConfirmed: boolean; error?: string } {
  const project = getProject(projectId);
  if (!project) return { success: false, allConfirmed: false, error: '项目不存在' };

  const char = project.novel.characters.find(c => c.id === characterId);
  if (!char) return { success: false, allConfirmed: false, error: '角色不存在' };

  if (imageUrls) char.imageUrls = imageUrls;
  char.confirmed = true;

  const mainChars = project.novel.characters.filter(c => c.role !== 'minor');
  const allConfirmed = mainChars.every(c => c.confirmed);

  updateProject(projectId, { novel: project.novel, status: allConfirmed ? 'scripting' : 'character_confirm' });
  return { success: true, allConfirmed };
}

// 更新角色图 URL
export function updateCharacterImages(projectId: string, characterId: string, imageUrls: string[]): boolean {
  return updateCharacterFields(projectId, characterId, { imageUrls });
}

// 更新角色参考图
export function updateCharacterRefImage(projectId: string, characterId: string, refImageUrl: string | undefined): boolean {
  return updateCharacterFields(projectId, characterId, { refImageUrl });
}

// 更新场景图 URL
export function updateLocationImage(projectId: string, locationId: string, imageUrl: string): boolean {
  return updateLocationFields(projectId, locationId, { imageUrl });
}

// 原子级角色字段更新：每次从 DB 读取最新数据，只修改目标角色的指定字段，避免并发覆盖
export function updateCharacterFields(projectId: string, characterId: string, fields: Partial<CharacterInfo>): boolean {
  const project = getProject(projectId);
  if (!project) return false;
  const char = project.novel.characters.find(c => c.id === characterId);
  if (!char) return false;
  Object.assign(char, fields);
  updateProject(projectId, { novel: project.novel });
  return true;
}

// 原子级场景字段更新：每次从 DB 读取最新数据，只修改目标场景的指定字段
export function updateLocationFields(projectId: string, locationId: string, fields: Partial<LocationInfo>): boolean {
  const project = getProject(projectId);
  if (!project) return false;
  const loc = project.novel.locations.find(l => l.id === locationId);
  if (!loc) return false;
  Object.assign(loc, fields);
  updateProject(projectId, { novel: project.novel });
  return true;
}

// 从磁盘扫描图片文件，恢复丢失的数据库关联（修复竞态条件导致的数据丢失）
export function repairProjectImages(projectId: string): { repairedChars: string[]; repairedLocs: string[]; errors: string[] } {
  const project = getProject(projectId);
  if (!project) return { repairedChars: [], repairedLocs: [], errors: ['项目不存在'] };

  const projectDir = safeDirName(project.novel.title || project.id);
  const basePath = getLocalImagePath(projectDir);
  const repairedChars: string[] = [];
  const repairedLocs: string[] = [];
  const errors: string[] = [];

  // 修复角色图片
  const charsDir = `${basePath}/characters`;
  if (fs.existsSync(charsDir)) {
    for (const char of project.novel.characters) {
      const charDir = `${charsDir}/${safeDirName(char.newName)}`;
      if (!fs.existsSync(charDir)) continue;

      const files = fs.readdirSync(charDir).filter(f => f.endsWith('.jpg'));
      if (files.length === 0) continue;

      // 按文件名模式分类
      const mainFiles = files.filter(f => f.includes('_main_'));
      const frontFile = files.find(f => f.includes('_front_'));
      const sideFile = files.find(f => f.includes('_side_'));
      const backFile = files.find(f => f.includes('_back_'));
      const costumeFile = files.find(f => f.includes('_costume_'));

      const toUrl = (f: string) => `/api/images/${projectDir}/characters/${safeDirName(char.newName)}/${f}`;

      // 恢复 imageUrls（主图候选）
      const needRepair = char.imageUrls.length === 0 || !char.profileImages?.main;
      if (!needRepair) continue;

      const updates: Partial<CharacterInfo> = {};

      if (mainFiles.length > 0 && char.imageUrls.length === 0) {
        updates.imageUrls = mainFiles.map(toUrl);
      }

      // 恢复 profileImages
      const profileImages: Record<string, string> = { ...(char.profileImages || {}) } as Record<string, string>;
      let profileChanged = false;
      if (mainFiles.length > 0 && !profileImages.main) { profileImages.main = toUrl(mainFiles[0]); profileChanged = true; }
      if (frontFile && !profileImages.front) { profileImages.front = toUrl(frontFile); profileChanged = true; }
      if (sideFile && !profileImages.side) { profileImages.side = toUrl(sideFile); profileChanged = true; }
      if (backFile && !profileImages.back) { profileImages.back = toUrl(backFile); profileChanged = true; }
      if (costumeFile && !profileImages.costume) { profileImages.costume = toUrl(costumeFile); profileChanged = true; }

      if (profileChanged) updates.profileImages = profileImages;
      if (profileImages.main) { updates.confirmed = true; updates.profileStatus = 'done'; }

      if (Object.keys(updates).length > 0) {
        updateCharacterFields(projectId, char.id, updates);
        repairedChars.push(char.newName);
        console.log(`[repair] 角色 ${char.newName} 图片已恢复: ${files.length} 张`);
      }
    }
  }

  // 修复场景图片
  const locsDir = `${basePath}/locations`;
  if (fs.existsSync(locsDir)) {
    for (const loc of project.novel.locations) {
      const locDir = `${locsDir}/${safeDirName(loc.newName)}`;
      if (!fs.existsSync(locDir)) continue;

      const files = fs.readdirSync(locDir).filter(f => f.endsWith('.jpg'));
      if (files.length === 0) continue;

      const needRepair = !loc.imageUrl && (!loc.imageUrls || loc.imageUrls.length === 0);
      if (!needRepair) continue;

      const toUrl = (f: string) => `/api/images/${projectDir}/locations/${safeDirName(loc.newName)}/${f}`;
      const localUrls = files.map(toUrl);

      updateLocationFields(projectId, loc.id, {
        imageUrls: localUrls,
        imageUrl: localUrls[0], // 默认选第一张
      });
      repairedLocs.push(loc.newName);
      console.log(`[repair] 场景 ${loc.newName} 图片已恢复: ${files.length} 张`);
    }
  }

  // 检查所有主角/配角是否都已确认，更新项目状态
  const freshProject = getProject(projectId);
  if (freshProject) {
    const mainChars = freshProject.novel.characters.filter(c => c.role !== 'minor');
    const allConfirmed = mainChars.every(c => c.confirmed);
    if (allConfirmed && freshProject.status === 'character_confirm') {
      updateProject(projectId, { status: 'scripting' });
    }
  }

  return { repairedChars, repairedLocs, errors };
}

// ============================================================
// 角色转Agent - 将小说角色提取为可复用的群演Agent
// 复用 analyzeNovel 的角色提取结果，生成角色扮演提示词
// ============================================================

/** 为单个角色生成Agent系统提示词 */
function buildCharacterAgentPrompt(char: CharacterInfo, novelTitle: string, novelSummary: string): string {
  return `你是「${char.newName || char.originalName}」，来自小说《${novelTitle}》的角色。

## 角色档案
- 身份：${char.role === 'protagonist' ? '主角' : char.role === 'supporting' ? '配角' : '龙套'}
- 外貌特征：${char.description}
- 性格特质：${char.personality}
- 视觉描述：${char.visualPrompt}
${char.costumeDesc ? `- 服化道：${char.costumeDesc}` : ''}

## 故事背景
${novelSummary}

## 行为准则
1. 始终以「${char.newName || char.originalName}」的身份说话和行动
2. 保持角色性格一致性：${char.personality}
3. 对话风格要符合角色设定，不要跳出角色
4. 在新的故事场景中，保持核心性格特征，但可以根据新剧情自然发展
5. 与其他角色互动时，体现角色关系和情感张力`;
}

/** 从已分析的项目中批量提取角色为Agent */
export function extractCharacterAgents(
  projectId: string,
  options?: { rolesFilter?: ('protagonist' | 'supporting' | 'minor')[]; category?: string },
): { success: boolean; agents: Array<{ id: string; name: string; role: string }>; error?: string } {
  const project = getProject(projectId);
  if (!project) return { success: false, agents: [], error: '项目不存在' };
  if (!project.novel?.characters?.length) return { success: false, agents: [], error: '项目尚未完成角色提取' };

  const rolesFilter = options?.rolesFilter || ['protagonist', 'supporting'];
  const category = options?.category || project.novel.themes?.[0] || '';
  const novelTitle = project.novel.title || '未命名';
  const novelSummary = project.novel.summary || '';
  const now = Date.now();
  const results: Array<{ id: string; name: string; role: string }> = [];

  for (const char of project.novel.characters) {
    if (!rolesFilter.includes(char.role as 'protagonist' | 'supporting' | 'minor')) continue;

    const agentId = `ca_${projectId.slice(0, 6)}_${char.id}`;
    const systemPrompt = buildCharacterAgentPrompt(char, novelTitle, novelSummary);

    insertCharacterAgent({
      id: agentId,
      name: char.newName || char.originalName,
      role: char.role,
      source_novel: novelTitle,
      source_project_id: projectId,
      category,
      description: char.description,
      personality: char.personality,
      visual_prompt: char.visualPrompt,
      costume_desc: char.costumeDesc || '',
      system_prompt: systemPrompt,
      profile_images: JSON.stringify(char.profileImages || {}),
      tags: JSON.stringify([char.role, category].filter(Boolean)),
      created_at: now,
      updated_at: now,
    });

    results.push({ id: agentId, name: char.newName || char.originalName, role: char.role });
  }

  return { success: true, agents: results };
}

// 角色生图提示词
export function buildCharacterImagePrompt(character: CharacterInfo, style: string): string {
  return `${style}, 全身角色设定图, 多角度（正面、侧面、背面）, ` +
    `${character.description}, ${character.personality}的表情, ` +
    `统一设计, 干净背景, 高质量, 细节丰富`;
}

// 集数分配到四幕
function distributeEpisodes(total: number): [number, number, number, number] {
  const q = Math.floor(total / 4);
  const r = total % 4;
  return [q + (r > 0 ? 1 : 0), q + (r > 1 ? 1 : 0), q + (r > 2 ? 1 : 0), q];
}

// ============================================================
// 阶段3：批量视频生成 - 逐集串行生成，支持视频延长衔接
// ============================================================

import { generateSeedanceVideo } from './video-generator.js';
import type { TaskInfo } from './types.js';
import { isLocalImageUrl, localUrlToFilename, getLocalImagePath, generateImage as genImage, downloadImageToLocal } from './image-generator.js';
import { FAKE_HEADERS } from './utils.js';
import fs from 'fs';

// 下载远程图片/视频到内存 Buffer，构造 Multer 兼容的 File 对象
// 支持本地路径（/api/images/xxx.jpg）和远程 URL
async function downloadAsMulterFile(url: string, filename: string, mimetype: string): Promise<Express.Multer.File> {
  let buffer: Buffer;

  if (isLocalImageUrl(url)) {
    // 本地文件，直接读取
    const localPath = getLocalImagePath(localUrlToFilename(url));
    if (!fs.existsSync(localPath)) throw new Error(`本地图片不存在: ${url}`);
    buffer = fs.readFileSync(localPath);
  } else {
    // 远程 URL，带 headers 下载
    const resp = await fetch(url, {
      headers: {
        'User-Agent': FAKE_HEADERS['User-Agent'],
        'Referer': 'https://jimeng.jianying.com/',
      },
    });
    if (!resp.ok) throw new Error(`下载失败 (${resp.status}): ${url.substring(0, 80)}`);
    buffer = Buffer.from(await resp.arrayBuffer());
  }

  return {
    fieldname: 'files',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    buffer,
    size: buffer.length,
  } as Express.Multer.File;
}

// ============================================================
// 每集专属参考图生成
// ============================================================

interface RefImageMark {
  index: number;       // @图片N 的 N
  description: string; // [描述内容]
  characterName?: string; // 从描述中提取的角色名
}

// 解析脚本中的【参考】标记，提取每张参考图的描述
// 格式: 【参考】@图片1 [陆燃打架凶狠], @图片2 [沈清言高冷进店]
export function parseReferenceMarks(prompt: string): RefImageMark[] {
  const marks: RefImageMark[] = [];
  // 匹配【参考】后面的内容
  const refMatch = prompt.match(/【参考】(.+?)(?:\n|$)/);
  if (!refMatch) return marks;

  const refLine = refMatch[1];
  // 匹配 @图片N [描述] 或 @图片N【描述】
  const pattern = /@图片(\d+)\s*[【\[](.*?)[】\]]/g;
  let m;
  while ((m = pattern.exec(refLine)) !== null) {
    marks.push({
      index: parseInt(m[1]),
      description: m[2].trim(),
    });
  }

  // 尝试从描述中提取角色名（描述通常是"角色名+动作/状态"）
  return marks;
}

// 根据角色名匹配角色信息
function matchCharacterByName(characters: CharacterInfo[], description: string): CharacterInfo | undefined {
  // 优先精确匹配角色名
  for (const char of characters) {
    if (description.includes(char.newName) || description.includes(char.originalName)) {
      return char;
    }
  }
  return undefined;
}

// 为单集生成专属参考图
// 解析脚本中的【参考】标记，用角色图+场景描述生成对应图片
export async function generateEpisodeRefImages(
  project: DramaProject,
  episode: EpisodeScript,
  sessionId: string,
  onProgress?: (msg: string) => void,
): Promise<string[]> {
  const marks = parseReferenceMarks(episode.prompt);
  if (marks.length === 0) {
    // 没有参考标记，使用通用角色图
    return collectReferenceImages(project, episode);
  }

  const refUrls: string[] = [];

  for (const mark of marks) {
    try {
      // 匹配角色
      const char = matchCharacterByName(project.novel.characters, mark.description);
      // 构建生图 prompt：风格 + 角色外观 + 场景描述
      let imgPrompt = `${project.style}, ${mark.description}`;
      if (char) {
        imgPrompt = `${project.style}, ${char.description}, ${mark.description}`;
      }

      onProgress?.(`E${String(episode.number).padStart(2, '0')} 生成参考图 ${mark.index}/${marks.length}: ${mark.description.substring(0, 30)}`);
      console.log(`[ref-img] E${episode.number} @图片${mark.index}: "${imgPrompt.substring(0, 80)}..."`);

      const images = await genImage(imgPrompt, sessionId, {
        width: 1280, height: 720, count: 1, style: project.style,
      });

      if (images.length > 0) {
        // 下载到本地
        const filename = await downloadImageToLocal(images[0].imageUrl, sessionId, `ref_ep${episode.number}_${mark.index}`, getProjectImageSubDir(project, 'refs'));
        refUrls.push(`/api/images/${filename}`);
      }
    } catch (err) {
      console.error(`[ref-img] E${episode.number} @图片${mark.index} 生成失败: ${(err as Error).message}`);
      // 生成失败时，如果能匹配到角色，用角色的档案主图或通用图
      const char = matchCharacterByName(project.novel.characters, mark.description);
      if (char) {
        const charUrl = char.profileImages?.main || (char.imageUrls.length > 0 ? char.imageUrls[0] : null);
        if (charUrl) refUrls.push(charUrl);
      }
    }
  }

  // 如果一张都没生成成功，使用通用角色图兜底
  if (refUrls.length === 0) {
    return collectReferenceImages(project, episode);
  }

  return refUrls;
}

// 批量为所有集生成专属参考图（并发控制）
export async function batchGenerateRefImages(
  projectId: string,
  sessionId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };
  if (project.episodes.length === 0) return { success: false, error: '无脚本' };

  const total = project.episodes.length;
  const concurrency = 2; // 同时生成2集的参考图（每集可能有多张，避免并发过高）
  let completed = 0;

  // 先确保角色图和场景图都已下载到本地
  const localResult = await ensureLocalImages(projectId, sessionId, onProgress);
  if (localResult.expiredChars.length > 0) {
    return { success: false, error: `以下角色图片已过期，请返回角色确认步骤重新生成: ${localResult.expiredChars.join('、')}` };
  }

  onProgress?.(`开始生成参考图: ${total} 集`);

  // 分批并发
  for (let i = 0; i < total; i += concurrency) {
    const batch = project.episodes.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (episode) => {
        const refUrls = await generateEpisodeRefImages(project, episode, sessionId, onProgress);
        episode.refImageUrls = refUrls;
        completed++;
        onProgress?.(`参考图进度: ${completed}/${total} 集完成`);
        return refUrls;
      }),
    );

    // 记录失败
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'rejected') {
        const ep = batch[j];
        console.error(`[ref-img] E${ep.number} 批量生成失败: ${(results[j] as PromiseRejectedResult).reason?.message}`);
      }
    }

    // 每批完成后保存进度
    updateProject(projectId, { episodes: project.episodes });

    // 批间间隔
    if (i + concurrency < total) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  updateProject(projectId, { episodes: project.episodes });
  onProgress?.(`参考图生成完成: ${completed}/${total} 集`);
  console.log(`[ref-img] 全部完成: ${completed}/${total} 集`);

  return { success: true };
}

// 确保项目中所有角色图和场景图都已下载到本地
// 自动检测远程 URL，下载到 data/images/ 并更新数据库
export async function ensureLocalImages(
  projectId: string,
  sessionId: string,
  onProgress?: (msg: string) => void,
): Promise<{ downloaded: number; failed: number; expiredChars: string[] }> {
  const project = getProject(projectId);
  if (!project) return { downloaded: 0, failed: 0, expiredChars: [] };

  let downloaded = 0;
  let failed = 0;
  let changed = false;
  const expiredChars: string[] = []; // 图片过期需要重新生成的角色

  // 检查角色图
  for (const char of project.novel.characters) {
    const remoteUrls = char.imageUrls.filter(u => !isLocalImageUrl(u));
    if (remoteUrls.length === 0) continue; // 全部已是本地图，跳过

    const newUrls: string[] = [];
    let charFailed = 0;
    for (const url of char.imageUrls) {
      if (isLocalImageUrl(url)) {
        newUrls.push(url);
        continue;
      }
      try {
        onProgress?.(`下载角色图: ${char.newName}`);
        const filename = await downloadImageToLocal(url, sessionId, `char_${char.id}`, getProjectImageSubDir(project, 'characters', char.newName));
        newUrls.push(`/api/images/${filename}`);
        downloaded++;
        changed = true;
      } catch (err) {
        console.log(`[ensure-local] 角色 ${char.newName} 图片下载失败: ${(err as Error).message}`);
        charFailed++;
        failed++;
        // 不保留过期的远程 URL
      }
    }

    if (charFailed > 0 && newUrls.length === 0) {
      // 该角色所有图片都下载失败（CDN 过期），清空并取消确认
      char.imageUrls = [];
      char.confirmed = false;
      expiredChars.push(char.newName);
      changed = true;
      console.log(`[ensure-local] 角色 ${char.newName} 所有图片已过期，需重新生成`);
    } else {
      char.imageUrls = newUrls;
      changed = true;
    }
  }

  // 检查场景图
  for (const loc of project.novel.locations) {
    if (!loc.imageUrl || isLocalImageUrl(loc.imageUrl)) continue;
    try {
      onProgress?.(`下载场景图: ${loc.newName}`);
      const filename = await downloadImageToLocal(loc.imageUrl, sessionId, `loc_${loc.id}`, getProjectImageSubDir(project, 'locations', loc.newName));
      loc.imageUrl = `/api/images/${filename}`;
      downloaded++;
      changed = true;
    } catch (err) {
      console.log(`[ensure-local] 场景 ${loc.newName} 图片下载失败: ${(err as Error).message}`);
      loc.imageUrl = undefined; // 清除过期链接
      changed = true;
      failed++;
    }
  }

  if (changed) {
    updateProject(projectId, { novel: project.novel });
  }

  if (expiredChars.length > 0) {
    const msg = `以下角色图片已过期，请返回角色确认步骤重新生成: ${expiredChars.join('、')}`;
    onProgress?.(msg);
    console.log(`[ensure-local] ${msg}`);
  } else if (downloaded > 0 || failed > 0) {
    const msg = `图片本地化: ${downloaded} 张成功, ${failed} 张失败`;
    onProgress?.(msg);
    console.log(`[ensure-local] ${msg}`);
  }

  return { downloaded, failed, expiredChars };
}


// 收集角色参考图和场景图（已确认的角色图片 + 对应场景图）
// 新版：优先使用角色档案的三视图（根据分镜需求选择合适角度）
function collectReferenceImages(project: DramaProject, episode: EpisodeScript): string[] {
  const charUrls: string[] = [];
  const locUrls: string[] = [];

  // 收集角色图（智能选择角度）
  for (const charId of (episode.characterRefs || [])) {
    const char = project.novel.characters.find(c => c.id === charId);
    if (char && char.profileImages) {
      // 优先使用三视图中的正面图（最常用）
      const mainUrl = char.profileImages.front || char.profileImages.main || char.imageUrls[0];
      if (mainUrl) charUrls.push(mainUrl);
      
      // 如果有侧面和背面图，也添加进来（提供更多角度参考）
      if (char.profileImages.side) charUrls.push(char.profileImages.side);
      if (char.profileImages.back) charUrls.push(char.profileImages.back);
    } else if (char && char.imageUrls.length > 0) {
      // 降级：使用旧版图片
      charUrls.push(char.imageUrls[0]);
    }
  }
  
  // 如果没有 characterRefs，取所有已确认主角的档案图
  if (charUrls.length === 0) {
    for (const char of project.novel.characters) {
      if (char.confirmed && char.profileImages) {
        const mainUrl = char.profileImages.front || char.profileImages.main || char.imageUrls[0];
        if (mainUrl) charUrls.push(mainUrl);
      } else if (char.confirmed && char.imageUrls.length > 0) {
        charUrls.push(char.imageUrls[0]);
      }
    }
  }

  // 收集场景图
  for (const locId of (episode.locationRefs || [])) {
    const loc = project.novel.locations.find(l => l.id === locId);
    if (loc?.imageUrl) locUrls.push(loc.imageUrl);
  }
  // 如果没有 locationRefs，取所有有图的场景
  if (!(episode.locationRefs?.length)) {
    for (const loc of project.novel.locations) {
      if (loc.imageUrl) locUrls.push(loc.imageUrl);
    }
  }

  // 优先保证场景图至少有1张，然后再添加角色图
  // 策略：1张场景图 + 最多4张角色图，或者如果没有场景图则全部用角色图
  const urls: string[] = [];
  if (locUrls.length > 0) {
    urls.push(locUrls[0]); // 至少1张场景图
    urls.push(...charUrls.slice(0, 4)); // 最多4张角色图
  } else {
    urls.push(...charUrls.slice(0, 5)); // 没有场景图时，全部用角色图
  }

  return urls.slice(0, 5); // 最多5张
}

export interface BatchProgressCallback {
  (episode: number, total: number, status: string, detail?: string): void;
}

export async function batchGenerateVideos(
  projectId: string,
  sessionId: string,
  tasks: Map<string, TaskInfo>,
  onProgress: BatchProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };
  if (project.episodes.length === 0) return { success: false, error: '无脚本可生成' };

  updateProject(projectId, { status: 'batch_generating' });
  const total = project.episodes.length;
  let prevVideoUrl: string | null = null;

  // 先确保角色图和场景图都已下载到本地
  onProgress(0, total, 'generating', '正在检查并下载图片到本地...');
  const localResult = await ensureLocalImages(projectId, sessionId, (msg) => {
    onProgress(0, total, 'generating', msg);
  });
  if (localResult.expiredChars.length > 0) {
    updateProject(projectId, { status: 'character_confirm' });
    return { success: false, error: `以下角色图片已过期，请返回角色确认步骤重新生成: ${localResult.expiredChars.join('、')}` };
  }

  for (let i = 0; i < total; i++) {
    const episode = project.episodes[i];
    const epNum = episode.number || (i + 1);
    const shots = episode.shots;
    const totalShots = shots.length;

    if (totalShots === 0) throw new Error(`第 ${epNum} 集没有分镜数据，请重新生成脚本`);

    // 更新当前集状态
    episode.videoStatus = 'generating';
    updateProject(projectId, { episodes: project.episodes });
    onProgress(epNum, total, 'generating', `正在生成第 ${epNum}/${total} 集 (${totalShots} 个分镜)...`);

    try {
      let prevShotVideoUrl: string | null = null;
      let allShotsDone = true;

      // 逐分镜生成
      for (let si = 0; si < shots.length; si++) {
        const shot = shots[si];
        const shotLabel = `E${String(epNum).padStart(2, '0')}-S${String(shot.index).padStart(2, '0')}`;
        const shotDuration = shot.endTime - shot.startTime;

        // 断点续传：跳过已完成的分镜
        if (shot.videoStatus === 'done' && shot.videoUrl) {
          console.log(`[batch] ${shotLabel} 已完成，跳过`);
          prevShotVideoUrl = shot.videoUrl;
          continue;
        }

        shot.videoStatus = 'generating';
        updateProject(projectId, { episodes: project.episodes });
        onProgress(epNum, total, 'generating', `第 ${epNum} 集 分镜 ${si + 1}/${totalShots} (${shot.startTime}-${shot.endTime}s)...`);

        try {
          const files: Express.Multer.File[] = [];

          // 第一个分镜：用参考图 + 上一集最后视频
          if (si === 0) {
            // 上一集的视频作为参考（跨集衔接）
            if (i > 0 && prevVideoUrl) {
              try {
                const videoFile = await downloadAsMulterFile(prevVideoUrl, `prev_ep.mp4`, 'video/mp4');
                files.push(videoFile);
              } catch (err) {
                console.log(`[batch] ${shotLabel} 下载上集视频失败: ${(err as Error).message}`);
              }
            }
            // 优先传入当前分镜引用的场景基准图（保证场景一致性）
            const shotLocRefs = shot.locationRefs || episode.locationRefs || [];
            for (const locId of shotLocRefs.slice(0, 2)) {
              const loc = project.novel.locations.find(l => l.id === locId);
              if (loc?.imageUrl) {
                try {
                  const file = await downloadAsMulterFile(loc.imageUrl, 'loc.jpg', 'image/jpeg');
                  files.push(file);
                } catch { /* skip */ }
              }
            }
            // 补充角色参考图（优先档案主图）
            const shotCharRefs = shot.characterRefs || episode.characterRefs || [];
            for (const charId of shotCharRefs.slice(0, 2)) {
              const char = project.novel.characters.find(c => c.id === charId);
              const charUrl = char?.profileImages?.main || char?.imageUrls?.[0];
              if (charUrl) {
                try {
                  const file = await downloadAsMulterFile(charUrl, 'char.jpg', 'image/jpeg');
                  files.push(file);
                } catch { /* skip */ }
              }
            }
            // 兜底：如果上面没收集到足够参考图，用 collectReferenceImages 补充
            if (files.length < 2) {
              const imageUrls = (episode.refImageUrls && episode.refImageUrls.length > 0)
                ? episode.refImageUrls
                : collectReferenceImages(project, episode);
              for (const url of imageUrls.slice(0, 5 - files.length)) {
                try {
                  const file = await downloadAsMulterFile(url, 'ref.jpg', 'image/jpeg');
                  files.push(file);
                } catch { /* skip */ }
              }
            }
          } else if (prevShotVideoUrl) {
            // 后续分镜：用前一个分镜的视频作为参考（分镜间衔接）
            try {
              const videoFile = await downloadAsMulterFile(prevShotVideoUrl, `prev_shot.mp4`, 'video/mp4');
              files.push(videoFile);
            } catch (err) {
              console.log(`[batch] ${shotLabel} 下载前分镜视频失败: ${(err as Error).message}`);
            }
            // 补充本分镜的角色/场景参考图（优先档案主图）
            const shotCharRefs = shot.characterRefs || episode.characterRefs || [];
            const shotLocRefs = shot.locationRefs || episode.locationRefs || [];
            for (const charId of shotCharRefs.slice(0, 2)) {
              const char = project.novel.characters.find(c => c.id === charId);
              const charUrl = char?.profileImages?.main || char?.imageUrls?.[0];
              if (charUrl) {
                try {
                  const file = await downloadAsMulterFile(charUrl, 'char.jpg', 'image/jpeg');
                  files.push(file);
                } catch { /* skip */ }
              }
            }
            for (const locId of shotLocRefs.slice(0, 1)) {
              const loc = project.novel.locations.find(l => l.id === locId);
              if (loc?.imageUrl) {
                try {
                  const file = await downloadAsMulterFile(loc.imageUrl, 'loc.jpg', 'image/jpeg');
                  files.push(file);
                } catch { /* skip */ }
              }
            }
          }

          // 兜底：前面的参考文件都获取失败时，收集项目中可用的参考图
          if (files.length === 0) {
            const fallbackUrls = collectReferenceImages(project, episode);
            for (const url of fallbackUrls.slice(0, 3)) {
              try {
                const file = await downloadAsMulterFile(url, 'fallback.jpg', 'image/jpeg');
                files.push(file);
              } catch { /* skip */ }
            }
          }
          if (files.length === 0) throw new Error('无可用参考图片');

          // 构建 prompt
          let prompt = shot.prompt || '';
          if (si > 0 && prevShotVideoUrl) {
            prompt = `将@视频1延长${shotDuration}s\n${prompt}`;
          }

          const taskId = `drama_${projectId}_ep${epNum}_s${shot.index}_${Date.now()}`;
          const task: TaskInfo = {
            id: taskId, status: 'processing', progress: `${shotLabel} 生成中...`,
            startTime: Date.now(), result: null, error: null, prompt,
            model: 'seedance-2.0', ratio: project.ratio, duration: shotDuration,
          };
          tasks.set(taskId, task);

          const videoUrl = await generateSeedanceVideo(taskId, {
            prompt, ratio: project.ratio, duration: shotDuration,
            files, sessionId, model: 'seedance-2.0',
          }, tasks);

          shot.videoUrl = videoUrl;
          shot.videoStatus = 'done';
          prevShotVideoUrl = videoUrl;
          console.log(`[batch] ${shotLabel} 生成成功`);

          // 分镜间间隔
          if (si < shots.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (err) {
          shot.videoStatus = 'error';
          shot.videoError = (err as Error).message;
          allShotsDone = false;
          console.error(`[batch] ${shotLabel} 生成失败: ${(err as Error).message}`);
          // 继续下一个分镜
        }

        updateProject(projectId, { episodes: project.episodes });
      }

      // 整集状态：最后一个成功分镜的视频作为整集视频
      const lastDoneShot = [...shots].reverse().find(s => s.videoStatus === 'done');
      if (lastDoneShot?.videoUrl) {
        episode.videoUrl = lastDoneShot.videoUrl;
        prevVideoUrl = lastDoneShot.videoUrl;
      }

      episode.videoStatus = 'done';
      updateProject(projectId, { episodes: project.episodes });
      onProgress(epNum, total, 'done', `第 ${epNum} 集生成完成 (${shots.filter(s => s.videoStatus === 'done').length}/${totalShots} 分镜)`);

      console.log(`[batch] 第 ${epNum}/${total} 集生成成功`);

      // 集间间隔
      if (i < total - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      episode.videoStatus = 'error';
      episode.videoError = (err as Error).message;
      updateProject(projectId, { episodes: project.episodes });
      onProgress(epNum, total, 'error', `第 ${epNum} 集失败: ${(err as Error).message}`);
      console.error(`[batch] 第 ${epNum}/${total} 集生成失败: ${(err as Error).message}`);
    }
  }

  // 全部完成
  const doneCount = project.episodes.filter(e => e.videoStatus === 'done').length;
  const finalStatus = doneCount === total ? 'batch_done' : 'batch_partial';
  updateProject(projectId, { status: finalStatus });
  onProgress(0, total, 'complete', `批量生成完成: ${doneCount}/${total} 集成功`);

  return { success: true };
}

