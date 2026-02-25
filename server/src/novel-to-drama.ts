// 小说转短剧服务 - LLM 直接调用版
// 工作流：小说拆解 → 版权改造 → 角色图生成 → 剧本压缩
// 后端直接调用 LLM，前端无需手动复制 prompt

import { chatCompletionJSON, getLLMConfig, type LLMConfig } from './llm-service.js';
import {
  insertProject, getProjectById, updateProjectFields, listAllProjects, deleteProject,
  logLLMCall, getProjectLogs, type DramaProjectRow,
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
  imageUrls: string[];
  confirmed: boolean;
}

export interface LocationInfo {
  id: string;
  originalName: string;
  newName: string;
  description: string;
  visualPrompt: string;
}

export interface PlotPoint {
  chapter: number;
  summary: string;
  emotionalTone: string;
  keyEvents: string[];
}

export interface EpisodeScript {
  number: number;
  title: string;
  act: string;
  emotionalTone: string;
  prompt: string;
  characterRefs: string[];
  locationRefs: string[];
  endingFrame: string;
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
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
}

// ============================================================
// DB ↔ DramaProject 转换
// ============================================================

function rowToProject(row: DramaProjectRow): DramaProject {
  return {
    id: row.id,
    novel: JSON.parse(row.novel_data || '{}'),
    targetEpisodes: row.target_episodes,
    style: row.style,
    ratio: row.ratio,
    episodeDuration: row.episode_duration,
    status: row.status,
    episodes: JSON.parse(row.episodes_data || '[]'),
    createdAt: row.created_at,
  };
}

function projectToRow(p: DramaProject): DramaProjectRow {
  return {
    id: p.id,
    title: p.novel?.title || '',
    status: p.status,
    target_episodes: p.targetEpisodes,
    style: p.style,
    ratio: p.ratio,
    episode_duration: p.episodeDuration,
    novel_data: JSON.stringify(p.novel),
    episodes_data: JSON.stringify(p.episodes),
    created_at: p.createdAt,
    updated_at: Date.now(),
  };
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
interface ParsedChapter {
  number: number;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

// 正则识别章节边界（借鉴 novelvids 的 NLP 策略）
// 支持：第X章、第X回、第X节、第X卷、Chapter N 等格式
const CHAPTER_PATTERN = /^\s*(第\s*([0-9零一二三四五六七八九十百千万亿]+)\s*[章回节篇卷])(.*)/gm;

function splitNovelIntoChapters(text: string): ParsedChapter[] {
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
function splitTextIntoChunks(text: string, maxCharsPerChunk: number): string[] {
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
5. 为每个角色生成英文生图提示词（用于 AI 生图工具生成角色参考图）
6. 为每个场景生成英文生图提示词

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
      "visualPrompt": "English prompt for AI image generation"
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "description": "详细环境描述（建筑风格、氛围、光线、季节等）",
      "visualPrompt": "English prompt for AI image generation"
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

  // 场景去重（按名字）
  const locMap = new Map<string, Record<string, string>>();
  for (const r of results) {
    for (const l of (r.locations || [])) {
      const name = l.name || '';
      if (!name) continue;
      const existing = locMap.get(name);
      if (!existing || (l.description || '').length > (existing.description || '').length) {
        locMap.set(name, l);
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

// 第1步：小说分析 - 三层策略
// 策略A（优先）：正则章节拆分 → 逐章/批次实体提取 → 跨章节增量合并
// 策略B（降级）：短文本直接分析 / 中等文本分块分析 / 超长文本递归压缩
// 百万字小说优先走策略A，保留每章细节不丢失
export type AnalyzeProgressCallback = (step: string, detail: string) => void;

// 逐章实体提取的 system prompt（比全量分析更聚焦，提取质量更高）
const CHAPTER_EXTRACT_PROMPT = `你是一位专业的影视编剧助手。请分析以下小说章节，提取所有实体信息。

## 提取要求
1. 提取所有出现的角色（名字、别名、身份、外貌、性格）
2. 提取所有场景/地点（名称、环境描述）
3. 提取本章核心情节（关键事件、情感基调）
4. 为每个角色生成英文生图提示词（visualPrompt）
5. 为每个场景生成英文生图提示词

请以 JSON 格式返回：
{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1", "绰号"],
      "role": "protagonist/supporting/minor",
      "description": "详细外貌描述（发型、服装、体型、年龄、标志性特征等）",
      "personality": "性格特征和行为模式",
      "visualPrompt": "English prompt for AI image generation"
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "aliases": ["别名"],
      "description": "详细环境描述（建筑风格、氛围、光线、季节等）",
      "visualPrompt": "English prompt for AI image generation"
    }
  ],
  "plotPoints": [
    {
      "summary": "情节概要",
      "emotionalTone": "情感基调",
      "keyEvents": ["关键事件1", "关键事件2"]
    }
  ],
  "chapterSummary": "本章200字以内摘要"
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

// 策略A：章节拆分 → 逐批实体提取 → 增量合并
async function analyzeByChapters(
  projectId: string,
  chapters: ParsedChapter[],
  maxCharsPerBatch: number,
  config: LLMConfig,
  progress: AnalyzeProgressCallback,
): Promise<{ title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, string>>; plotPoints?: PlotPoint[]; themes?: string[] }> {
  const batches = batchChapters(chapters, maxCharsPerBatch);
  console.log(`[drama] 章节分析: ${chapters.length} 章, 分 ${batches.length} 批处理`);
  progress('章节分析', `识别到 ${chapters.length} 个章节，分 ${batches.length} 批逐章提取实体...`);

  const accumulated = {
    characters: new Map<string, Record<string, unknown>>(),
    locations: new Map<string, Record<string, unknown>>(),
    plotPoints: [] as PlotPoint[],
    summaries: [] as string[],
    themes: [] as string[],
  };

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const chapterRange = batch.length === 1
      ? `第${batch[0].number}章`
      : `第${batch[0].number}-${batch[batch.length - 1].number}章`;
    progress('章节分析', `正在分析 ${chapterRange} (批次 ${bi + 1}/${batches.length})...`);

    // 拼接批次内所有章节内容
    const batchText = batch.map(ch => `=== ${ch.title} ===\n${ch.content}`).join('\n\n');
    const userPrompt = `以下是小说的 ${chapterRange}（共 ${chapters.length} 章中的第 ${bi + 1} 批）。请提取所有实体信息。\n\n${batchText}`;

    // 带重试的 LLM 调用（最多重试 2 次）
    let result: { success: boolean; data?: Record<string, unknown>; error?: string } = { success: false };
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        console.log(`[drama] 批次 ${bi + 1}/${batches.length} 第 ${retry + 1} 次重试...`);
        progress('章节分析', `批次 ${bi + 1}/${batches.length} 重试中 (${retry + 1}/3)...`);
        await new Promise(r => setTimeout(r, 3000 * retry)); // 递增等待
      }
      const startTime = Date.now();
      result = await chatCompletionJSON<Record<string, unknown>>(CHAPTER_EXTRACT_PROMPT, userPrompt);
      logLLMCall({ projectId, step: `chapter_extract_${bi + 1}${retry > 0 ? `_retry${retry}` : ''}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });
      if (result.success) break;
    }

    if (result.success && result.data) {
      // 增量合并每章的实体
      for (const ch of batch) {
        mergeChapterEntities(accumulated, result.data, ch.number);
      }
      console.log(`[drama] 批次 ${bi + 1}/${batches.length} 完成: 累计 ${accumulated.characters.size} 角色, ${accumulated.locations.size} 场景`);
    } else {
      console.log(`[drama] 批次 ${bi + 1}/${batches.length} 失败: ${result.error}`);
    }
  }

  // 最终精炼：用一次 LLM 调用整合所有章节的合并结果
  progress('整合精炼', `正在整合 ${chapters.length} 章的分析结果...`);
  const mergedData = {
    characters: [...accumulated.characters.values()].map(c => {
      const { _chapters, ...rest } = c as Record<string, unknown>;
      return rest;
    }),
    locations: [...accumulated.locations.values()],
    plotPoints: accumulated.plotPoints,
    summary: accumulated.summaries.join('\n'),
  };

  const refinePrompt = `你是一位专业编剧。以下是对一部长篇小说逐章分析后的合并结果。
请精炼和整合这些信息：
1. 写一个完整的 300 字以内故事梗概（不是片段拼接）
2. 确认每个角色的主次关系（protagonist/supporting/minor），去除重复角色
3. 合并重复的场景
4. 按时间线重新排列情节点
5. 提炼核心主题
6. 为每个角色和场景补充英文 visualPrompt（如果缺失）
7. 给出一个合适的故事标题

返回 JSON：
{
  "title": "故事标题",
  "summary": "300字以内完整梗概",
  "characters": [{ "name": "...", "role": "...", "description": "...", "personality": "...", "visualPrompt": "..." }],
  "locations": [{ "name": "...", "description": "...", "visualPrompt": "..." }],
  "plotPoints": [{ "chapter": 1, "summary": "...", "emotionalTone": "...", "keyEvents": ["..."] }],
  "themes": ["主题1", "主题2"]
}`;

  const refineText = JSON.stringify(mergedData).substring(0, maxCharsPerBatch);
  const startTime = Date.now();
  const refineResult = await chatCompletionJSON<Record<string, unknown>>(refinePrompt, refineText);
  logLLMCall({ projectId, step: 'chapter_refine', provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: refineResult.success, error: refineResult.error });

  if (refineResult.success && refineResult.data) {
    return refineResult.data as { title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, string>>; plotPoints?: PlotPoint[]; themes?: string[] };
  }

  // 精炼失败，返回原始合并结果
  return {
    title: '未命名',
    summary: accumulated.summaries.join(' ').substring(0, 500),
    characters: mergedData.characters as Array<Record<string, string>>,
    locations: mergedData.locations as Array<Record<string, string>>,
    plotPoints: accumulated.plotPoints,
    themes: [],
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

  let analysis: { title?: string; summary?: string; characters?: Array<Record<string, string>>; locations?: Array<Record<string, string>>; plotPoints?: PlotPoint[]; themes?: string[] };

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
      originalName: l.name || '',
      newName: l.name || '',
      description: l.description || '',
      visualPrompt: l.visualPrompt || '',
    })),
    plotPoints: analysis.plotPoints || [],
    themes: analysis.themes || [],
    totalChapters: chapters.length > 0 ? chapters.length : (analysis.plotPoints || []).length,
  };

  progress('完成', `分析完成: ${novel.characters.length} 角色, ${novel.locations.length} 场景, ${novel.plotPoints.length} 情节点`);
  updateProject(projectId, { novel, status: 'copyright_check' });
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
6. 为每个角色和场景补充英文 visualPrompt（如果缺失）

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

  const systemPrompt = `你是一位版权合规专家兼视觉设计师。请对以下故事元素进行改造，确保不侵犯原作版权，同时为每个角色和场景生成英文生图提示词。

改造规则：
1. 所有角色名更换为全新名字，保持角色性格和关系不变
2. 所有地名更换，保持地理特征和氛围不变
3. 核心情节保留，具体细节改编
4. 保持故事情感内核和主题不变
5. 公共领域作品（如水浒传、西游记等）可适度保留
6. 为每个角色生成统一风格前缀的英文生图提示词（用于 AI 生图工具）
7. 为每个场景生成英文生图提示词

请以 JSON 格式返回：
{
  "newTitle": "新标题",
  "characters": [
    {
      "originalName": "原名",
      "newName": "新名",
      "adjustedDescription": "调整后的中文外貌描述",
      "visualPrompt": "English image generation prompt with style prefix, e.g.: Chinese ink wash painting style, full body portrait, young warrior with..."
    }
  ],
  "locations": [
    {
      "originalName": "原名",
      "newName": "新名",
      "adjustedDescription": "调整后的中文环境描述",
      "visualPrompt": "English image generation prompt with style prefix"
    }
  ]
}`;

  const userContent = `标题：${project.novel.originalTitle || project.novel.title}
角色：${JSON.stringify(project.novel.characters.map(c => ({ name: c.originalName, role: c.role, desc: c.description })))}
地点：${JSON.stringify(project.novel.locations.map(l => ({ name: l.originalName, desc: l.description })))}`;

  const config = getLLMConfig();
  const startTime = Date.now();
  const result = await chatCompletionJSON<Record<string, unknown>>(systemPrompt, userContent);
  const durationMs = Date.now() - startTime;

  logLLMCall({ projectId, step: 'copyright', provider: config.provider, model: config.model, durationMs, success: result.success, error: result.error });

  if (!result.success || !result.data) return { success: false, error: result.error || 'LLM 版权改造失败' };

  const transforms = result.data as { newTitle?: string; characters?: Array<{ originalName: string; newName: string; adjustedDescription?: string; visualPrompt?: string }>; locations?: Array<{ originalName: string; newName: string; adjustedDescription?: string; visualPrompt?: string }> };

  // 应用改造
  if (transforms.characters) {
    for (const t of transforms.characters) {
      const char = project.novel.characters.find(c => c.originalName === t.originalName);
      if (char) {
        char.newName = t.newName;
        if (t.adjustedDescription) char.description = t.adjustedDescription;
        if (t.visualPrompt) char.visualPrompt = t.visualPrompt;
      }
    }
  }
  if (transforms.locations) {
    for (const t of transforms.locations) {
      const loc = project.novel.locations.find(l => l.originalName === t.originalName);
      if (loc) {
        loc.newName = t.newName;
        if (t.adjustedDescription) loc.description = t.adjustedDescription;
        if (t.visualPrompt) loc.visualPrompt = t.visualPrompt;
      }
    }
  }
  if (transforms.newTitle) project.novel.title = transforms.newTitle;

  updateProject(projectId, { novel: project.novel, status: 'character_confirm' });
  return { success: true, project: getProject(projectId) };
}

// 第3步：生成分镜脚本 - 集成阶段1（Seedance 时间轴格式）+ 阶段2（创意四关审核）
export async function generateScript(projectId: string): Promise<{ success: boolean; project?: DramaProject; error?: string }> {
  const project = getProject(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const actsDistribution = distributeEpisodes(project.targetEpisodes);
  const total = project.targetEpisodes;
  const dur = project.episodeDuration;

  // 构建角色和场景上下文（所有批次共用）
  const storyContext = `故事：${project.novel.summary}
风格：${project.style}
角色：
${project.novel.characters.filter(c => c.role !== 'minor').map(c => `- ${c.newName}(${c.id}): ${c.description}，性格：${c.personality}`).join('\n')}
场景：
${project.novel.locations.map(l => `- ${l.newName}(${l.id}): ${l.description}`).join('\n')}
情节：
${project.novel.plotPoints.map(p => `第${p.chapter}章 [${p.emotionalTone}]: ${p.summary}\n  关键事件：${(p.keyEvents || []).join('、')}`).join('\n')}
主题：${project.novel.themes.join('、')}`;

  // 构建时间轴模板
  const timeSlots: string[] = [];
  for (let t = 0; t < dur; t += 3) {
    const end = Math.min(t + 3, dur);
    timeSlots.push(`${t}-${end}s画面：[镜头运动]，[画面描述]`);
  }
  const timeTemplate = timeSlots.join('\n');

  // 根据模型输出能力决定每批生成多少集
  // 每集脚本约 500-800 token 输出，保守按 800 算
  const config = getLLMConfig();
  const outputTokens = config.maxTokens || 8000;
  const epsPerBatch = Math.max(2, Math.floor(outputTokens / 800));
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

  console.log(`[drama] 脚本生成: ${total} 集, 分 ${batches.length} 批 (每批约 ${epsPerBatch} 集)`);

  const buildScriptSystemPrompt = (batchFrom: number, batchTo: number, batchAct: string, prevEndingFrame?: string) => {
    let prompt = `你是一位专业的短剧编剧兼视频创意总监。请生成第 ${batchFrom}-${batchTo} 集的分镜脚本，每集 ${dur} 秒。

## 全剧四幕结构（起承转合）共 ${total} 集
- 起（第1幕）：第 1-${actsDistribution[0]} 集 — 人物介绍、世界观建立、事件起因
- 承（第2幕）：第 ${actsDistribution[0] + 1}-${actsDistribution[0] + actsDistribution[1]} 集 — 情节发展、矛盾升级、试炼之路
- 转（第3幕）：第 ${actsDistribution[0] + actsDistribution[1] + 1}-${actsDistribution[0] + actsDistribution[1] + actsDistribution[2]} 集 — 高潮、转折、最终对决
- 合（第4幕）：第 ${actsDistribution[0] + actsDistribution[1] + actsDistribution[2] + 1}-${total} 集 — 结局、主题升华

当前批次属于【${batchAct}】阶段。

## Seedance 2.0 时间轴分镜格式要求
每集的 prompt 必须严格按以下格式：

${project.style}，${project.ratio}，[整体氛围]

${timeTemplate}

【声音】[配乐风格] + [音效] + [对白/旁白]
【参考】@图片1 [角色/场景用途]，@图片2 [用途]...

## 运镜关键词（必须从以下词库选取）
景别：大远景、远景、全景、中景、近景、特写、大特写
运镜：推镜头、拉镜头、摇镜头、移镜头、跟拍、环绕拍摄、航拍、手持跟拍、希区柯克变焦
角度：平视、俯拍、仰拍、低角度、鸟瞰视角、第一人称视角
节奏：慢动作、快切、延时摄影、一镜到底、升格拍摄
特殊：遮挡擦镜转场、无缝渐变转场、环绕摇镜快切特写、定格慢放

## 创意四关自审
生成每集脚本后，必须自我审核：
1. 记忆点：观众看完能记住什么？
2. 意外感：是否有反转、对比、夸张？
3. 情绪弧线：有没有情绪变化？
4. 叙事变化：即使 ${dur} 秒也要有"从A到B"的变化

## 集与集衔接
- 每集必须有 endingFrame（最后一帧画面描述）
- 下一集开头要与上一集 endingFrame 自然衔接`;

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
    "prompt": "完整的 Seedance 2.0 时间轴格式提示词",
    "characterRefs": ["C01", "C02"],
    "locationRefs": ["S01"],
    "endingFrame": "最后一帧的详细画面描述"
  }
]`;
    return prompt;
  };

  const allEpisodes: EpisodeScript[] = [];
  let prevEndingFrame: string | undefined;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const systemPrompt = buildScriptSystemPrompt(batch.from, batch.to, batch.act, prevEndingFrame);

    const startTime = Date.now();
    const result = await chatCompletionJSON<EpisodeScript[]>(systemPrompt, storyContext);
    const durationMs = Date.now() - startTime;

    logLLMCall({ projectId, step: `script_batch_${i + 1}`, provider: config.provider, model: config.model, durationMs, success: result.success, error: result.error });

    if (!result.success || !result.data) {
      console.log(`[drama] 脚本批次 ${i + 1}/${batches.length} 失败: ${result.error}`);
      return { success: false, error: `第 ${batch.from}-${batch.to} 集脚本生成失败: ${result.error}` };
    }

    const batchEpisodes = Array.isArray(result.data) ? result.data : [];
    allEpisodes.push(...batchEpisodes);

    // 记录最后一集的 endingFrame 供下批衔接
    if (batchEpisodes.length > 0) {
      prevEndingFrame = batchEpisodes[batchEpisodes.length - 1].endingFrame;
    }

    console.log(`[drama] 脚本批次 ${i + 1}/${batches.length} 完成: 第 ${batch.from}-${batch.to} 集 (${batchEpisodes.length} 集)`);
  }

  updateProject(projectId, { episodes: allEpisodes, status: 'optimizing' });

  // 阶段2：创意优化 - 对生成的脚本进行创意四关审核
  const optimizeResult = await optimizeScripts(projectId);
  if (!optimizeResult.success) {
    // 优化失败不阻塞，使用原始脚本
    console.log(`[drama] 创意优化失败，使用原始脚本: ${optimizeResult.error}`);
    updateProject(projectId, { status: 'ready' });
  }

  return { success: true, project: getProject(projectId) };
}

// 阶段2：创意四关审核与优化（支持分批处理大量集数）
async function optimizeScripts(projectId: string): Promise<{ success: boolean; error?: string }> {
  const project = getProject(projectId);
  if (!project || project.episodes.length === 0) return { success: false, error: '无脚本可优化' };

  const config = getLLMConfig();
  const contextLimit = getModelContextLimit(config);
  const outputTokens = config.maxTokens || 8000;
  const safeInputChars = Math.floor((contextLimit - 2000 - outputTokens) / 1.5);

  const optimizeSystemPrompt = `你是视频创意总监。请对以下短剧分镜脚本进行创意四关审核和优化。

## 创意四关审核标准
对每集逐一检查：
1. **记忆点**：观众看完能记住什么？答案是"没什么"就重写
2. **意外感**：是否有反转、对比、夸张、不寻常的细节？全是意料之中=无聊
3. **情绪弧线**：有没有情绪变化？紧张→释放、平静→爆发、温馨→反转
4. **叙事变化**：即使几秒也要有"从A到B"的变化，不是静态展示

## 优化手段
- 调整运镜关键词，选择更有表现力的运镜（如：普通推镜头→希区柯克变焦）
- 增加情绪对比和视觉冲突
- 优化时间轴节奏分配（不要平均分配，重点画面给更多时间）
- 确保集与集之间衔接自然（endingFrame → 下集开头）
- 加入声音设计细节（环境音、音效先行、ASMR质感等）

## 要求
- 对每集给出审核评分（1-10分）和修改说明
- 评分低于7分的集数必须重写 prompt
- 返回优化后的完整脚本数组（格式与输入相同）

返回 JSON：
{
  "episodes": [原格式的优化后脚本数组],
  "reviews": [
    { "number": 1, "score": 8, "notes": "记忆点：xxx，优化了xxx" }
  ]
}`;

  // 将集数分批，每批不超过 token 限制
  const allEpisodes = project.episodes;
  const batches: EpisodeScript[][] = [];
  let currentBatch: EpisodeScript[] = [];
  let currentSize = 0;

  for (const ep of allEpisodes) {
    const epSize = JSON.stringify(ep).length;
    // 预留 style 前缀和 JSON 格式开销
    if (currentSize + epSize > safeInputChars - 200 && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(ep);
    currentSize += epSize;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  console.log(`[drama] 创意优化: ${allEpisodes.length} 集, 分 ${batches.length} 批处理`);

  const allOptimized: EpisodeScript[] = [];
  const allReviews: Array<{ number: number; score: number; notes: string }> = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const userContent = `风格：${project.style}
当前脚本（第 ${batch[0].number}-${batch[batch.length - 1].number} 集，共 ${allEpisodes.length} 集中的第 ${i + 1} 批）：
${JSON.stringify(batch, null, 2)}`;

    const startTime = Date.now();
    const result = await chatCompletionJSON<{ episodes?: EpisodeScript[]; reviews?: Array<{ number: number; score: number; notes: string }> }>(
      optimizeSystemPrompt, userContent,
    );
    logLLMCall({ projectId, step: `optimize_batch_${i + 1}`, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });

    if (result.success && result.data?.episodes) {
      allOptimized.push(...result.data.episodes);
      if (result.data.reviews) allReviews.push(...result.data.reviews);
      console.log(`[drama] 优化批次 ${i + 1}/${batches.length} 完成: ${result.data.episodes.length} 集`);
    } else {
      // 该批次优化失败，保留原始脚本
      allOptimized.push(...batch);
      console.log(`[drama] 优化批次 ${i + 1}/${batches.length} 失败，保留原始: ${result.error}`);
    }
  }

  if (allOptimized.length > 0) {
    updateProject(projectId, { episodes: allOptimized, status: 'ready' });
    const avgScore = allReviews.length > 0 ? (allReviews.reduce((s, r) => s + r.score, 0) / allReviews.length).toFixed(1) : 'N/A';
    console.log(`[drama] 创意优化完成: ${allOptimized.length} 集，平均评分 ${avgScore}`);
  } else {
    updateProject(projectId, { status: 'ready' });
  }

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
  const project = getProject(projectId);
  if (!project) return false;
  const char = project.novel.characters.find(c => c.id === characterId);
  if (!char) return false;
  char.imageUrls = imageUrls;
  updateProject(projectId, { novel: project.novel });
  return true;
}

// 角色生图提示词
export function buildCharacterImagePrompt(character: CharacterInfo, style: string): string {
  return `${style}, full body character reference sheet, multiple angles (front, side, back), ` +
    `${character.description}, ${character.personality} expression, ` +
    `consistent design, clean background, high quality, detailed`;
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

// 下载远程图片/视频到内存 Buffer，构造 Multer 兼容的 File 对象
async function downloadAsMulterFile(url: string, filename: string, mimetype: string): Promise<Express.Multer.File> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载失败 (${resp.status}): ${url.substring(0, 80)}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return {
    fieldname: 'files',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    buffer,
    size: buffer.length,
  } as Express.Multer.File;
}

// 收集角色参考图（已确认的角色图片）
function collectCharacterImages(project: DramaProject, episode: EpisodeScript): string[] {
  const urls: string[] = [];
  for (const charId of (episode.characterRefs || [])) {
    const char = project.novel.characters.find(c => c.id === charId);
    if (char && char.imageUrls.length > 0) {
      urls.push(char.imageUrls[0]); // 取第一张
    }
  }
  // 如果没有 characterRefs，取所有已确认主角的图
  if (urls.length === 0) {
    for (const char of project.novel.characters) {
      if (char.confirmed && char.imageUrls.length > 0) {
        urls.push(char.imageUrls[0]);
      }
    }
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

  for (let i = 0; i < total; i++) {
    const episode = project.episodes[i];
    const epNum = episode.number || (i + 1);

    // 更新当前集状态
    episode.videoStatus = 'generating';
    updateProject(projectId, { episodes: project.episodes });
    onProgress(epNum, total, 'generating', `正在生成第 ${epNum}/${total} 集...`);

    try {
      // 构建参考文件列表
      const files: Express.Multer.File[] = [];

      if (i === 0) {
        // 第1集：使用角色参考图
        const charImageUrls = collectCharacterImages(project, episode);
        for (let j = 0; j < charImageUrls.length; j++) {
          try {
            const file = await downloadAsMulterFile(charImageUrls[j], `char_${j + 1}.jpg`, 'image/jpeg');
            files.push(file);
            onProgress(epNum, total, 'generating', `第 ${epNum} 集：已下载角色图 ${j + 1}/${charImageUrls.length}`);
          } catch (err) {
            console.log(`[batch] 下载角色图失败: ${(err as Error).message}`);
          }
        }
      } else if (prevVideoUrl) {
        // 第2集起：使用上一集视频作为参考
        try {
          onProgress(epNum, total, 'generating', `第 ${epNum} 集：正在下载上一集视频作为参考...`);
          const videoFile = await downloadAsMulterFile(prevVideoUrl, `prev_ep_${epNum - 1}.mp4`, 'video/mp4');
          files.push(videoFile);
        } catch (err) {
          console.log(`[batch] 下载上一集视频失败，改用角色图: ${(err as Error).message}`);
          // 降级：使用角色图
          const charImageUrls = collectCharacterImages(project, episode);
          for (const url of charImageUrls.slice(0, 3)) {
            try {
              const file = await downloadAsMulterFile(url, 'char.jpg', 'image/jpeg');
              files.push(file);
            } catch { /* skip */ }
          }
        }
      }

      // 如果完全没有参考文件，至少用一张角色图
      if (files.length === 0) {
        const fallbackUrls = collectCharacterImages(project, episode);
        if (fallbackUrls.length > 0) {
          try {
            const file = await downloadAsMulterFile(fallbackUrls[0], 'fallback.jpg', 'image/jpeg');
            files.push(file);
          } catch { /* skip */ }
        }
      }

      if (files.length === 0) {
        throw new Error('无可用参考图片，请先为角色生成参考图');
      }

      // 构建 prompt：第2集起加视频延长前缀
      let prompt = episode.prompt || '';
      if (i > 0 && prevVideoUrl) {
        prompt = `将@视频1延长${project.episodeDuration}s\n${prompt}`;
      }

      // 创建任务并生成视频
      const taskId = `drama_${projectId}_ep${epNum}_${Date.now()}`;
      const task: TaskInfo = {
        id: taskId,
        status: 'processing',
        progress: `第 ${epNum} 集生成中...`,
        startTime: Date.now(),
        result: null,
        error: null,
        prompt,
        model: 'seedance-2.0',
        ratio: project.ratio,
        duration: project.episodeDuration,
      };
      tasks.set(taskId, task);

      onProgress(epNum, total, 'generating', `第 ${epNum} 集：已提交视频生成请求...`);

      const videoUrl = await generateSeedanceVideo(taskId, {
        prompt,
        ratio: project.ratio,
        duration: project.episodeDuration,
        files,
        sessionId,
        model: 'seedance-2.0',
      }, tasks);

      // 成功
      episode.videoUrl = videoUrl;
      episode.videoStatus = 'done';
      prevVideoUrl = videoUrl;
      updateProject(projectId, { episodes: project.episodes });
      onProgress(epNum, total, 'done', `第 ${epNum} 集生成完成`);

      console.log(`[batch] 第 ${epNum}/${total} 集生成成功: ${videoUrl.substring(0, 60)}...`);

      // 集间间隔，避免请求过快
      if (i < total - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      episode.videoStatus = 'error';
      episode.videoError = (err as Error).message;
      updateProject(projectId, { episodes: project.episodes });
      onProgress(epNum, total, 'error', `第 ${epNum} 集失败: ${(err as Error).message}`);
      console.error(`[batch] 第 ${epNum}/${total} 集生成失败: ${(err as Error).message}`);
      // 继续下一集（不中断整个流程）
    }
  }

  // 全部完成
  const doneCount = project.episodes.filter(e => e.videoStatus === 'done').length;
  const finalStatus = doneCount === total ? 'batch_done' : 'batch_partial';
  updateProject(projectId, { status: finalStatus });
  onProgress(0, total, 'complete', `批量生成完成: ${doneCount}/${total} 集成功`);

  return { success: true };
}

