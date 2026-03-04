// 创作工厂 - 进化式Agent选择系统
// 复用 novel-to-drama 的小说解析 + screenplay-creator 的知识库
import crypto from 'crypto';
import { chatCompletionJSON, chatCompletion, getLLMConfig } from './llm-service.js';
import { logLLMCall, insertFactoryProject, getFactoryProjectById, listFactoryProjects, deleteFactoryProject, type FactoryProjectRow } from './db-service.js';
import { splitNovelIntoChapters, splitTextIntoChunks, type ParsedChapter } from './novel-to-drama.js';

// ============================================================
// 类型定义
// ============================================================

/** 小说写作DNA（风格指纹） */
export interface NovelDNA {
  title: string;
  genre: string;
  tone: string;
  narrativeStyle: string;
  pacing: string;
  dialogueStyle: string;
  descriptionDensity: string;
  emotionalCurve: string;
  hookTechniques: string[];
  satisfactionPatterns: string[];
  characterVoices: string[];
  thematicElements: string[];
  chapterStructure: string;
  wordCountPerChapter: number;
  openingTechnique: string;
  cliffhangerStyle: string;
  conflictEscalation: string;
  uniqueTraits: string[];
}

/** 章节摘要（轻量，用于前端展示） */
export interface ChapterContent {
  number: number;
  title: string;
  content: string;
  wordCount: number;
}

/** Agent定义 */
export interface WritingAgent {
  id: string;
  generation: number;
  parentId?: string;
  systemPrompt: string;
  styleDirective: string;
  techniqueWeights: Record<string, number>;
  score?: number;
  rank?: number;
  output?: string;
  scoreHistory: number[];
  mutationLog: string[];
}

/** 评选结果 */
export interface EvalResult {
  agentId: string;
  scores: {
    styleSimilarity: number;
    narrativeFlow: number;
    hookEffectiveness: number;
    characterConsistency: number;
    emotionalResonance: number;
    overallFidelity: number;
  };
  total: number;
  feedback: string;
}

/** 进化轮次 */
export interface EvolutionRound {
  chapter: number; // 兼容旧数据，新数据中为阶段编号
  stage?: number; // 阶段编号
  stageName?: string; // 阶段名称
  generation: number;
  totalAgents: number;
  topAgents: Array<{ id: string; score: number }>;
  avgScore: number;
  bestScore: number;
  lowestScore: number; // 最低分（用于预热判断）
  timestamp: number;
}

/** 故事阶段（多章合并） */
export interface StoryStage {
  index: number; // 阶段编号 1-based
  name: string; // 阶段名称，如"开篇·校园日常"
  chapterRange: [number, number]; // 起止章节号
  chapters: ChapterContent[]; // 包含的章节
  excerpt: string; // 合并后的代表性文本（截取，用于写作参考和评分）
  summary: string; // 阶段内容概要
}

/** 工厂项目 */
export interface FactoryProject {
  id: string;
  status: 'init' | 'parsing' | 'parsed' | 'evolving' | 'paused' | 'completed' | 'error';
  novelText: string;
  novelDNA?: NovelDNA;
  chapters: ChapterContent[];
  stages: StoryStage[]; // 故事阶段（8-10个）
  agents: WritingAgent[];
  currentChapter: number;
  currentGeneration: number;
  evolutionHistory: EvolutionRound[];
  finalAgent?: WritingAgent;
  concurrency: number;
  agentsPerGeneration: number;
  topK: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

// 内存存储 + 中断标志
const factoryProjects = new Map<string, FactoryProject>();
const stopFlags = new Map<string, boolean>();

// ============================================================
// 持久化辅助
// ============================================================

/** 内存项目 → DB行 */
function projectToRow(p: FactoryProject): FactoryProjectRow {
  return {
    id: p.id, status: p.status, novel_text: p.novelText,
    novel_dna: p.novelDNA ? JSON.stringify(p.novelDNA) : null,
    chapters: JSON.stringify(p.chapters),
    stages: JSON.stringify(p.stages || []),
    // 持久化agent时去掉output（太大），只保留结构信息
    agents: JSON.stringify(p.agents.map(a => ({ ...a, output: undefined }))),
    current_chapter: p.currentChapter, current_generation: p.currentGeneration,
    evolution_history: JSON.stringify(p.evolutionHistory),
    final_agent: p.finalAgent ? JSON.stringify({ ...p.finalAgent, output: undefined }) : null,
    concurrency: p.concurrency, agents_per_generation: p.agentsPerGeneration, top_k: p.topK,
    created_at: p.createdAt, updated_at: p.updatedAt, error: p.error || null,
  };
}

/** DB行 → 内存项目 */
function rowToProject(r: FactoryProjectRow): FactoryProject {
  return {
    id: r.id, status: r.status as FactoryProject['status'], novelText: r.novel_text,
    novelDNA: r.novel_dna ? JSON.parse(r.novel_dna) : undefined,
    chapters: JSON.parse(r.chapters || '[]'),
    stages: JSON.parse(r.stages || '[]'),
    agents: JSON.parse(r.agents || '[]'),
    currentChapter: r.current_chapter, currentGeneration: r.current_generation,
    evolutionHistory: JSON.parse(r.evolution_history || '[]'),
    finalAgent: r.final_agent ? JSON.parse(r.final_agent) : undefined,
    concurrency: r.concurrency, agentsPerGeneration: r.agents_per_generation, topK: r.top_k,
    createdAt: r.created_at, updatedAt: r.updated_at, error: r.error || undefined,
  };
}

/** 持久化当前项目到 SQLite */
function persistFactory(id: string): void {
  const p = factoryProjects.get(id);
  if (p) {
    try { insertFactoryProject(projectToRow(p)); }
    catch (err) { console.error(`[agent-factory] 持久化失败 ${id}:`, (err as Error).message); }
  }
}

/** 启动时从 SQLite 恢复所有工厂项目到内存 */
export function restoreFactories(): void {
  try {
    const rows = listFactoryProjects();
    for (const row of rows) {
      const project = rowToProject(row);
      // 如果上次是 evolving 状态（被中断），恢复为 paused
      if (project.status === 'evolving') project.status = 'paused';
      factoryProjects.set(project.id, project);
    }
    if (rows.length > 0) console.log(`[agent-factory] 从数据库恢复了 ${rows.length} 个工厂项目`);
  } catch (err) { console.error('[agent-factory] 恢复失败:', (err as Error).message); }
}

// ============================================================
// CRUD
// ============================================================

export function createFactory(novelText: string, options?: { concurrency?: number; agentsPerGeneration?: number; topK?: number }): FactoryProject {
  const id = crypto.randomUUID();
  const project: FactoryProject = {
    id, status: 'init', novelText,
    chapters: [], stages: [], agents: [],
    currentChapter: 0, currentGeneration: 0,
    evolutionHistory: [],
    concurrency: options?.concurrency || 5,
    agentsPerGeneration: options?.agentsPerGeneration || 100,
    topK: options?.topK || 10,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  factoryProjects.set(id, project);
  persistFactory(id);
  return project;
}

export function getFactory(id: string): FactoryProject | undefined { return factoryProjects.get(id); }
export function updateFactory(id: string, updates: Partial<FactoryProject>): FactoryProject | undefined {
  const p = factoryProjects.get(id); if (!p) return undefined;
  Object.assign(p, updates, { updatedAt: Date.now() });
  persistFactory(id);
  return p;
}
export function listFactories(): FactoryProject[] { return Array.from(factoryProjects.values()).sort((a, b) => b.createdAt - a.createdAt); }
export function removeFactory(id: string): void {
  factoryProjects.delete(id);
  stopFlags.delete(id);
  try { deleteFactoryProject(id); } catch { /* ignore */ }
}

/** 请求中断进化 */
export function requestStop(id: string): boolean {
  const p = factoryProjects.get(id);
  if (!p || p.status !== 'evolving') return false;
  stopFlags.set(id, true);
  return true;
}

/** 检查是否被中断 */
function isStopped(id: string): boolean {
  return stopFlags.get(id) === true;
}

// ============================================================
// LLM 调用辅助（复用 screenplay-creator 的模式）
// ============================================================

const LOG_PREFIX = '[agent-factory]';

/** 带日志的进度通知 */
function emitProgress(onProgress: ((msg: string) => void) | undefined, msg: string): void {
  console.log(`${LOG_PREFIX} ${msg}`);
  onProgress?.(msg);
}

async function llmJSON<T>(projectId: string, step: string, system: string, user: string): Promise<{ success: boolean; data?: T; error?: string }> {
  const config = getLLMConfig();
  const startTime = Date.now();
  console.log(`${LOG_PREFIX} [LLM-JSON] ${step} 开始调用 ${config.provider}/${config.model}`);
  const result = await chatCompletionJSON<T>(system, user, { timeoutMs: 600000 });
  const dur = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${LOG_PREFIX} [LLM-JSON] ${step} ${result.success ? '✅' : '❌'} (${dur}s)`);
  logLLMCall({ projectId, step, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });
  return result;
}

async function llmText(projectId: string, step: string, system: string, user: string): Promise<{ success: boolean; content?: string; error?: string }> {
  const config = getLLMConfig();
  const startTime = Date.now();
  console.log(`${LOG_PREFIX} [LLM-Text] ${step} 开始调用 ${config.provider}/${config.model}`);
  const result = await chatCompletion(system, user, { timeoutMs: 600000 });
  const dur = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${LOG_PREFIX} [LLM-Text] ${step} ${result.success ? '✅' : '❌'} (${dur}s, ${result.content?.length || 0} chars)`);
  logLLMCall({ projectId, step, provider: config.provider, model: config.model, durationMs: Date.now() - startTime, success: result.success, error: result.error });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, content: result.content };
}

/** 并发控制器 */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: (T | undefined)[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();
  for (let i = 0; i < tasks.length; i++) {
    const idx = i;
    const p = (async () => {
      try { results[idx] = await tasks[idx](); }
      catch (err) { console.error(`[agent-factory] 并发任务 ${idx} 失败:`, (err as Error).message); }
    })();
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results.filter((r): r is T => r !== undefined);
}

// 技巧维度（融合 screenplay-creator 知识库的维度）
const TECHNIQUE_DIMENSIONS = [
  'hook_strength', 'dialogue_ratio', 'description_density', 'pacing_speed',
  'emotion_intensity', 'conflict_density', 'humor_level', 'suspense_buildup',
  'character_depth', 'scene_transition',
];


// ============================================================
// 步骤1: 解析小说DNA（复用 novel-to-drama 的章节拆分）
// ============================================================

export async function parseNovelDNA(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const project = getFactory(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  updateFactory(projectId, { status: 'parsing' });
  emitProgress(onProgress, `[1/4] 开始解析小说DNA（全文 ${(project.novelText.length / 10000).toFixed(1)} 万字）`);

  // 复用 novel-to-drama 的章节拆分
  emitProgress(onProgress, '[1/4] 拆分章节中...');
  const parsed = splitNovelIntoChapters(project.novelText);

  let chapters: ChapterContent[];
  if (parsed.length >= 3) {
    chapters = parsed.map(ch => ({ number: ch.number, title: ch.title, content: ch.content, wordCount: ch.content.length }));
    emitProgress(onProgress, `[1/4] 章节拆分完成：识别到 ${chapters.length} 个章节`);
  } else {
    emitProgress(onProgress, '[1/4] 未识别到标准章节格式，按段落分块...');
    const chunks = splitTextIntoChunks(project.novelText, 5000);
    if (chunks.length === 0) return { success: false, error: '无法识别章节结构' };
    chapters = chunks.map((c, i) => ({ number: i + 1, title: `段落${i + 1}`, content: c, wordCount: c.length }));
    emitProgress(onProgress, `[1/4] 段落分块完成：${chapters.length} 个段落`);
  }

  updateFactory(projectId, { chapters });

  // ====== 分批采样分析 ======
  // 将全书分成多个批次，每批采样5章，均匀覆盖
  const CHAPTERS_PER_BATCH = 5;
  const MAX_CHARS_PER_CHAPTER = 3000;
  const batchIndices = buildBatchSampleIndices(chapters.length, CHAPTERS_PER_BATCH);
  const totalBatches = batchIndices.length;
  const totalSteps = totalBatches + 2; // 拆分 + N批分析 + 汇总

  emitProgress(onProgress, `[2/${totalSteps}] 全书 ${chapters.length} 章，分 ${totalBatches} 批采样分析（每批${CHAPTERS_PER_BATCH}章）`);

  const batchAnalysisSystem = `你是一位专业的文学分析师。请对以下小说片段进行风格分析，提取写作特征。
输出严格JSON格式：
{
  "narrativeStyle": "叙事风格",
  "pacing": "节奏特征",
  "dialogueStyle": "对话风格",
  "descriptionDensity": "描写密度",
  "emotionalTone": "情感基调",
  "hookTechniques": ["钩子技巧"],
  "satisfactionPatterns": ["爽点模式"],
  "characterVoices": ["角色语言特征"],
  "uniqueTraits": ["独特写作手法"],
  "conflictPattern": "冲突模式",
  "sectionSummary": "本段内容概要（50字内）"
}`;

  const batchResults: string[] = [];

  for (let b = 0; b < totalBatches; b++) {
    const indices = batchIndices[b];
    const stepNum = b + 2;
    const chapterNums = indices.map(i => i + 1).join(', ');
    emitProgress(onProgress, `[${stepNum}/${totalSteps}] 第${b + 1}/${totalBatches}批：分析第 ${chapterNums} 章...`);

    const sampleText = indices.map(i =>
      `【第${chapters[i].number}章：${chapters[i].title}】\n${chapters[i].content.slice(0, MAX_CHARS_PER_CHAPTER)}`
    ).join('\n\n---\n\n');

    // 带重试的批次分析（最多3次）
    let batchSuccess = false;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        const waitSec = 5 * retry;
        emitProgress(onProgress, `[${stepNum}/${totalSteps}] 第${b + 1}批第${retry + 1}次重试（等待${waitSec}s）...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }

      const result = await llmText(projectId, `parse_batch_${b}${retry > 0 ? `_retry${retry}` : ''}`, batchAnalysisSystem,
        `以下是小说的第${b + 1}批采样（全书共${chapters.length}章）：\n\n${sampleText}\n\n请分析这些章节的写作特征，输出JSON。`);

      if (result.success && result.content) {
        batchResults.push(result.content);
        emitProgress(onProgress, `[${stepNum}/${totalSteps}] 第${b + 1}批分析完成 ✓`);
        batchSuccess = true;
        break;
      }

      if (retry === 2) {
        emitProgress(onProgress, `[${stepNum}/${totalSteps}] 第${b + 1}批分析失败（已重试3次），跳过: ${result.error || '未知'}`);
      }
    }
  }

  if (batchResults.length === 0) {
    updateFactory(projectId, { status: 'error', error: '所有批次分析均失败' });
    return { success: false, error: '所有批次分析均失败' };
  }

  // ====== 汇总阶段 ======
  emitProgress(onProgress, `[${totalSteps}/${totalSteps}] 汇总 ${batchResults.length} 批分析结果，生成最终DNA...`);

  const mergeSystem = `你是一位专业的文学分析师。以下是对一部小说多个批次的分析结果。
请综合所有批次的分析，提取这部小说的完整写作DNA。
注意：不同批次可能反映小说不同阶段的风格变化，请综合考虑。
输出严格JSON格式。`;

  const mergeUser = `全书共 ${chapters.length} 章，以下是 ${batchResults.length} 批分析结果：

${batchResults.map((r, i) => `=== 第${i + 1}批（${batchIndices[i]?.map(idx => `第${idx + 1}章`).join('、')}）===\n${r}`).join('\n\n')}

请综合以上所有批次，输出最终的写作DNA，JSON格式：
{
  "title": "小说标题（从内容推断）",
  "genre": "题材类型",
  "tone": "整体基调",
  "narrativeStyle": "叙事风格描述",
  "pacing": "节奏特征描述",
  "dialogueStyle": "对话风格描述",
  "descriptionDensity": "描写密度：浓密/适中/简洁",
  "emotionalCurve": "情感曲线特征描述（含不同阶段的变化）",
  "hookTechniques": ["钩子技巧1", "钩子技巧2", ...],
  "satisfactionPatterns": ["爽点模式1", "爽点模式2", ...],
  "characterVoices": ["角色A的语言特征", "角色B的语言特征", ...],
  "thematicElements": ["主题元素1", "主题元素2", ...],
  "chapterStructure": "章节结构特征描述",
  "wordCountPerChapter": ${Math.round(chapters.reduce((s, c) => s + c.wordCount, 0) / chapters.length)},
  "openingTechnique": "开篇技巧描述",
  "cliffhangerStyle": "悬念风格描述",
  "conflictEscalation": "冲突升级模式描述",
  "uniqueTraits": ["独特写作特征1", "独特写作特征2", ...]
}`;

  const finalResult = await llmJSON<NovelDNA>(projectId, 'parse_dna_merge', mergeSystem, mergeUser);
  if (!finalResult.success || !finalResult.data) {
    emitProgress(onProgress, `❌ DNA汇总失败: ${finalResult.error || '未知错误'}`);
    updateFactory(projectId, { status: 'error', error: finalResult.error || 'DNA汇总失败' });
    return { success: false, error: finalResult.error || 'DNA汇总失败' };
  }

  emitProgress(onProgress, `✅ DNA解析完成 - 「${finalResult.data.title}」 ${finalResult.data.genre}/${finalResult.data.tone}（${totalBatches}批分析汇总）`);
  updateFactory(projectId, { novelDNA: finalResult.data, status: 'parsed' });
  return { success: true };
}

// ============================================================
// 步骤2: 生成初代Agent群
// ============================================================

export async function generateInitialAgents(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const project = getFactory(projectId);
  if (!project?.novelDNA) return { success: false, error: '请先解析小说DNA' };

  const { novelDNA, agentsPerGeneration } = project;
  emitProgress(onProgress, `正在生成 ${agentsPerGeneration} 个初代Agent（${TECHNIQUE_DIMENSIONS.length}个技巧维度）...`);

  // 短暂延迟，等待前端 WebSocket 订阅就绪
  await new Promise(r => setTimeout(r, 500));

  const agents: WritingAgent[] = [];
  for (let i = 0; i < agentsPerGeneration; i++) {
    const weights: Record<string, number> = {};
    for (const dim of TECHNIQUE_DIMENSIONS) {
      weights[dim] = Math.round((0.1 + Math.random() * 0.9) * 100) / 100;
    }
    const styleDirective = buildStyleDirective(novelDNA, weights);
    agents.push({
      id: `gen0_${String(i).padStart(3, '0')}`,
      generation: 0,
      systemPrompt: buildAgentSystemPrompt(novelDNA, styleDirective),
      styleDirective,
      techniqueWeights: weights,
      scoreHistory: [],
      mutationLog: ['初始随机生成'],
    });
    if ((i + 1) % 20 === 0 || i === agentsPerGeneration - 1) {
      emitProgress(onProgress, `Agent生成进度: ${i + 1}/${agentsPerGeneration}`);
      // 让出事件循环，确保 WebSocket 消息能及时发送
      await new Promise(r => setTimeout(r, 0));
    }
  }

  updateFactory(projectId, { agents, currentGeneration: 0 });
  emitProgress(onProgress, `✅ ${agentsPerGeneration} 个初代Agent生成完成`);
  return { success: true };
}

// ============================================================
// 步骤3: 进化竞赛（核心循环）
// ============================================================

export async function runEvolutionRound(
  projectId: string,
  stage: StoryStage,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; round?: EvolutionRound; error?: string }> {
  const project = getFactory(projectId);
  if (!project?.novelDNA || project.agents.length === 0) return { success: false, error: '请先生成Agent群' };

  const activeAgents = project.agents;
  const generation = project.currentGeneration;

  updateFactory(projectId, { status: 'evolving', currentChapter: stage.index });
  emitProgress(onProgress, `📖 ${stage.name} 竞赛开始 - ${activeAgents.length}个Agent（第${generation}代）`);

  // 1. 所有Agent写作
  emitProgress(onProgress, `✍️ ${activeAgents.length}个Agent开始创作（并发${project.concurrency}）...`);
  let writeCompleted = 0;
  const writeStartTime = Date.now();
  const writeResults = await runWithConcurrency(
    activeAgents.map((agent) => async () => {
      const userPrompt = buildStageWritingPrompt(project.novelDNA!, stage);
      const result = await llmText(projectId, `evolve_s${stage.index}_${agent.id}`, agent.systemPrompt, userPrompt);
      writeCompleted++;
      if (writeCompleted % 5 === 0 || writeCompleted === activeAgents.length) {
        emitProgress(onProgress, `✍️ 创作进度: ${writeCompleted}/${activeAgents.length}（${((Date.now() - writeStartTime) / 1000).toFixed(0)}s）`);
      }
      return { agentId: agent.id, content: result.content || '', success: result.success };
    }),
    project.concurrency,
  );

  const successCount = writeResults.filter(r => r.success).length;
  emitProgress(onProgress, `✍️ 创作完成: ${successCount}/${activeAgents.length} 成功（${((Date.now() - writeStartTime) / 1000).toFixed(1)}s）`);

  for (const wr of writeResults) {
    const agent = activeAgents.find(a => a.id === wr.agentId);
    if (agent) agent.output = wr.content;
  }

  if (isStopped(projectId)) {
    return { success: false, error: '用户中断' };
  }

  // 2. 批量评选
  emitProgress(onProgress, `🏅 开始评分（${activeAgents.length}个作品，每批10个，并发${project.concurrency}）...`);
  const evalStartTime = Date.now();
  const evalResults = await evaluateAgentsByStage(projectId, stage, activeAgents, project.novelDNA!, onProgress, project.concurrency);
  emitProgress(onProgress, `🏅 评分完成（${((Date.now() - evalStartTime) / 1000).toFixed(1)}s）`);

  // 3. 排名 & 淘汰低分Agent
  evalResults.sort((a, b) => b.total - a.total);
  const MIN_SCORE = 10;
  for (let i = 0; i < evalResults.length; i++) {
    const agent = activeAgents.find(a => a.id === evalResults[i].agentId);
    if (agent) { agent.score = evalResults[i].total; agent.rank = i + 1; agent.scoreHistory.push(evalResults[i].total); }
  }

  const validAgents = activeAgents.filter(a => (a.score || 0) >= MIN_SCORE && a.output && a.output.length > 0);
  const culledCount = activeAgents.length - validAgents.length;
  if (culledCount > 0) {
    emitProgress(onProgress, `🗑️ 淘汰 ${culledCount} 个低分/无效Agent（低于${MIN_SCORE}分或无输出）`);
    updateFactory(projectId, { agents: validAgents });
  }

  // 4. 记录本轮（只统计存活Agent的分数）
  const validEvalResults = evalResults.filter(e => e.total >= MIN_SCORE);
  const topAgentIds = validEvalResults.slice(0, project.topK);
  const avgScore = validEvalResults.length > 0 ? validEvalResults.reduce((s, e) => s + e.total, 0) / validEvalResults.length : 0;
  const topKLowest = topAgentIds.length > 0 ? topAgentIds[topAgentIds.length - 1].total : 0;
  const round: EvolutionRound = {
    chapter: stage.index, stage: stage.index, stageName: stage.name,
    generation, totalAgents: validAgents.length,
    topAgents: topAgentIds.map(e => ({ id: e.agentId, score: e.total })),
    avgScore: Math.round(avgScore * 100) / 100, bestScore: validEvalResults[0]?.total || 0,
    lowestScore: topKLowest, timestamp: Date.now(),
  };
  updateFactory(projectId, { evolutionHistory: [...project.evolutionHistory, round] });
  emitProgress(onProgress, `✅ ${stage.name} 竞赛完成 - 🥇${round.bestScore}分 | Top${topAgentIds.length}最低${topKLowest}分 | 平均${round.avgScore}分 | 存活${validAgents.length}个`);
  return { success: true, round };
}

// ============================================================
// 步骤4: 变异繁殖
// ============================================================

export async function mutateAndBreed(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const project = getFactory(projectId);
  if (!project?.novelDNA) return { success: false, error: '项目数据不完整' };

  const { agents, topK, agentsPerGeneration, novelDNA } = project;
  const generation = project.currentGeneration + 1;
  const sorted = [...agents].filter(a => (a.score || 0) > 0).sort((a, b) => (b.score || 0) - (a.score || 0));

  if (sorted.length === 0) {
    emitProgress(onProgress, `⚠️ 没有有效Agent可繁殖，重新生成初代...`);
    return generateInitialAgents(projectId, onProgress);
  }

  const eliteCount = Math.min(topK, sorted.length);
  const elites = sorted.slice(0, eliteCount);

  emitProgress(onProgress, `🧬 开始繁殖第${generation}代（从Top${eliteCount}精英，每个精英${Math.floor(agentsPerGeneration / eliteCount)}个后代）`);
  emitProgress(onProgress, `🧬 分析精英Agent共同特征...`);

  const eliteAnalysis = await analyzeElites(projectId, elites, novelDNA);
  const newAgents: WritingAgent[] = [];
  const perElite = Math.floor(agentsPerGeneration / eliteCount);

  for (let i = 0; i < elites.length; i++) {
    const parent = elites[i];
    newAgents.push({ ...parent, id: `gen${generation}_elite_${String(i).padStart(2, '0')}`, generation, parentId: parent.id, mutationLog: [...parent.mutationLog, `精英保留（第${generation}代）`] });
    for (let j = 1; j < perElite; j++) {
      newAgents.push(mutateAgent(parent, generation, j, novelDNA, eliteAnalysis));
    }
    emitProgress(onProgress, `🧬 精英 ${i + 1}/${eliteCount}（${parent.id}, ${parent.score}分）→ ${perElite}个后代`);
  }

  while (newAgents.length < agentsPerGeneration) {
    const p1 = elites[Math.floor(Math.random() * elites.length)];
    const p2 = elites[Math.floor(Math.random() * elites.length)];
    if (p1.id !== p2.id) newAgents.push(crossoverAgents(p1, p2, generation, newAgents.length, novelDNA));
  }

  updateFactory(projectId, { agents: newAgents.slice(0, agentsPerGeneration), currentGeneration: generation });
  emitProgress(onProgress, `✅ 第${generation}代 ${agentsPerGeneration} 个Agent繁殖完成`);
  return { success: true };
}

// ============================================================
// 步骤5: 完整进化流程
// ============================================================

export async function runFullEvolution(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const project = getFactory(projectId);
  if (!project?.novelDNA || project.chapters.length === 0) return { success: false, error: '请先完成小说解析和Agent生成' };

  stopFlags.delete(projectId);

  if (project.agents.length === 0) {
    const genResult = await generateInitialAgents(projectId, onProgress);
    if (!genResult.success) return genResult;
  }

  // 构建故事阶段（8-10个）
  if (project.stages.length === 0) {
    const TARGET_STAGES = Math.min(10, Math.max(8, Math.ceil(project.chapters.length / 10)));
    const stages = buildStoryStages(project.chapters, TARGET_STAGES);
    updateFactory(projectId, { stages });
    emitProgress(onProgress, `📚 全书${project.chapters.length}章，拆分为${stages.length}个故事阶段`);
    for (const s of stages) {
      emitProgress(onProgress, `  ${s.name}`);
    }
  }

  const currentProject = getFactory(projectId)!;
  const stages = currentProject.stages;

  // ====== 预热阶段：用第1阶段反复迭代，直到Top10最低分≥36 ======
  const WARMUP_PASS_SCORE = 36; // 满分60，Top10最低分达到此值才进入正式进化
  const MAX_WARMUP_ROUNDS = 5;
  const alreadyWarmedUp = currentProject.evolutionHistory.some(r => (r.lowestScore || 0) >= WARMUP_PASS_SCORE);

  if (!alreadyWarmedUp && stages.length > 0) {
    emitProgress(onProgress, `\n🔥 预热阶段：用${stages[0].name}反复迭代，直到Top10最低分≥${WARMUP_PASS_SCORE}分（满分60）`);
    for (let warmup = 0; warmup < MAX_WARMUP_ROUNDS; warmup++) {
      if (isStopped(projectId)) {
        stopFlags.delete(projectId);
        updateFactory(projectId, { status: 'paused' });
        emitProgress(onProgress, `⏸ 预热阶段暂停`);
        return { success: true };
      }

      emitProgress(onProgress, `\n🔥 预热第${warmup + 1}/${MAX_WARMUP_ROUNDS}轮`);
      const roundResult = await runEvolutionRound(projectId, stages[0], onProgress);
      if (!roundResult.success) { updateFactory(projectId, { status: 'error', error: roundResult.error }); return { success: false, error: roundResult.error }; }

      const topKLowest = roundResult.round?.lowestScore || 0;
      if (topKLowest >= WARMUP_PASS_SCORE) {
        emitProgress(onProgress, `✅ 预热达标！Top10最低分 ${topKLowest} ≥ ${WARMUP_PASS_SCORE}，进入正式进化`);
        const mutateResult = await mutateAndBreed(projectId, onProgress);
        if (!mutateResult.success) { updateFactory(projectId, { status: 'error', error: mutateResult.error }); return { success: false, error: mutateResult.error }; }
        break;
      }

      emitProgress(onProgress, `🔥 Top10最低分 ${topKLowest} < ${WARMUP_PASS_SCORE}，继续预热...`);
      const mutateResult = await mutateAndBreed(projectId, onProgress);
      if (!mutateResult.success) { updateFactory(projectId, { status: 'error', error: mutateResult.error }); return { success: false, error: mutateResult.error }; }

      if (warmup === MAX_WARMUP_ROUNDS - 1) {
        emitProgress(onProgress, `⚠️ 预热${MAX_WARMUP_ROUNDS}轮后Top10最低分仍未达标（${topKLowest}分），继续正式进化`);
      }
    }
  }

  // ====== 正式进化：按故事阶段竞赛 ======
  // 跳过已完成的阶段（预热用的第1阶段也算已完成）
  const completedStages = new Set(currentProject.evolutionHistory.map(r => r.stage || r.chapter));
  const pendingStages = stages.filter(s => !completedStages.has(s.index));

  if (pendingStages.length === 0) {
    const latestProject = getFactory(projectId)!;
    const champion = [...latestProject.agents].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    updateFactory(projectId, { finalAgent: champion, status: 'completed' });
    emitProgress(onProgress, `🏆 进化已完成！冠军: ${champion.id}，得分: ${champion.score}`);
    return { success: true };
  }

  const totalRounds = stages.length;
  const completedRounds = totalRounds - pendingStages.length;

  emitProgress(onProgress, completedRounds > 0
    ? `\n🔄 恢复进化（${totalRounds}个阶段，已完成${completedRounds}个）`
    : `\n🚀 开始正式进化：${totalRounds}个故事阶段 × ${currentProject.agentsPerGeneration}个Agent`);

  // 恢复时补充变异繁殖
  if (completedRounds > 0 && currentProject.evolutionHistory.length > 0) {
    const lastRoundGen = currentProject.evolutionHistory[currentProject.evolutionHistory.length - 1]?.generation;
    if (lastRoundGen !== undefined && currentProject.currentGeneration === lastRoundGen) {
      emitProgress(onProgress, '🔄 恢复：补充上轮变异繁殖...');
      const mutateResult = await mutateAndBreed(projectId, onProgress);
      if (!mutateResult.success) { updateFactory(projectId, { status: 'error', error: mutateResult.error }); return { success: false, error: mutateResult.error }; }
    }
  }

  const fullStartTime = Date.now();

  for (let ri = 0; ri < pendingStages.length; ri++) {
    const stage = pendingStages[ri];
    const roundNum = completedRounds + ri + 1;

    if (isStopped(projectId)) {
      stopFlags.delete(projectId);
      updateFactory(projectId, { status: 'paused' });
      emitProgress(onProgress, `⏸ 已暂停（第${roundNum}/${totalRounds}轮前）`);
      return { success: true };
    }

    emitProgress(onProgress, `\n━━━ 第${roundNum}/${totalRounds}轮 · ${stage.name} ━━━`);

    const roundResult = await runEvolutionRound(projectId, stage, onProgress);
    if (!roundResult.success) { updateFactory(projectId, { status: 'error', error: roundResult.error }); return { success: false, error: roundResult.error }; }

    if (isStopped(projectId)) {
      stopFlags.delete(projectId);
      updateFactory(projectId, { status: 'paused' });
      emitProgress(onProgress, `⏸ 已暂停（${stage.name}竞赛完成后）`);
      return { success: true };
    }

    if (ri < pendingStages.length - 1) {
      const mutateResult = await mutateAndBreed(projectId, onProgress);
      if (!mutateResult.success) { updateFactory(projectId, { status: 'error', error: mutateResult.error }); return { success: false, error: mutateResult.error }; }
    }
  }

  const finalProject = getFactory(projectId)!;
  const champion = [...finalProject.agents].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  updateFactory(projectId, { finalAgent: champion, status: 'completed' });
  const totalTime = ((Date.now() - fullStartTime) / 1000 / 60).toFixed(1);
  emitProgress(onProgress, `🏆 进化完成！耗时${totalTime}分钟 | 冠军: ${champion.id}，得分: ${champion.score}`);
  return { success: true };
}

// ============================================================
// 导出最终Agent
// ============================================================

export function exportFinalAgent(projectId: string): { success: boolean; agent?: WritingAgent; prompt?: string; error?: string } {
  const project = getFactory(projectId);
  if (!project?.finalAgent) return { success: false, error: '进化尚未完成' };
  const agent = project.finalAgent;
  const exportPrompt = `${agent.systemPrompt}\n\n---\n## 风格指令\n${agent.styleDirective}\n\n## 技巧权重\n${JSON.stringify(agent.techniqueWeights, null, 2)}\n\n## 进化历史\n- 代数: ${agent.generation}\n- 评分: ${agent.scoreHistory.join(' → ')}\n- 变异:\n${agent.mutationLog.map(m => `  - ${m}`).join('\n')}`;
  return { success: true, agent, prompt: exportPrompt };
}

// ============================================================
// 内部辅助函数
// ============================================================

/** 为进化竞赛选取采样章节：均匀覆盖全书，最多 maxRounds 章 */
function selectEvolutionChapters(totalChapters: number, maxRounds: number = 10): number[] {
  if (totalChapters <= maxRounds) return Array.from({ length: totalChapters }, (_, i) => i + 1);
  const chapters: number[] = [1];
  const step = (totalChapters - 1) / (maxRounds - 1);
  for (let i = 1; i < maxRounds - 1; i++) {
    chapters.push(Math.round(1 + i * step));
  }
  chapters.push(totalChapters);
  return [...new Set(chapters)];
}

/** 将章节列表拆分为8-10个故事阶段 */
function buildStoryStages(chapters: ChapterContent[], targetStages: number = 8): StoryStage[] {
  const total = chapters.length;
  const stageCount = Math.min(targetStages, total);
  const perStage = Math.ceil(total / stageCount);
  const stages: StoryStage[] = [];

  for (let i = 0; i < stageCount; i++) {
    const start = i * perStage;
    const end = Math.min(start + perStage, total);
    const stageChapters = chapters.slice(start, end);
    if (stageChapters.length === 0) continue;

    const firstCh = stageChapters[0].number;
    const lastCh = stageChapters[stageChapters.length - 1].number;

    // 从阶段中提取代表性文本：首章开头 + 中间章片段 + 末章结尾
    const excerptParts: string[] = [];
    const maxPerPart = 1500;
    excerptParts.push(`【第${firstCh}章：${stageChapters[0].title}】\n${stageChapters[0].content.slice(0, maxPerPart)}`);
    if (stageChapters.length >= 3) {
      const mid = stageChapters[Math.floor(stageChapters.length / 2)];
      excerptParts.push(`【第${mid.number}章：${mid.title}】\n${mid.content.slice(0, maxPerPart)}`);
    }
    if (stageChapters.length >= 2) {
      const last = stageChapters[stageChapters.length - 1];
      excerptParts.push(`【第${last.number}章：${last.title}】\n${last.content.slice(-maxPerPart)}`);
    }

    stages.push({
      index: i + 1,
      name: `阶段${i + 1}（第${firstCh}-${lastCh}章）`,
      chapterRange: [firstCh, lastCh],
      chapters: stageChapters,
      excerpt: excerptParts.join('\n\n---\n\n'),
      summary: stageChapters.map(c => `第${c.number}章「${c.title}」`).join('、'),
    });
  }
  return stages;
}
/** 构建分批采样索引：将全书均匀分成多批，每批采样 perBatch 章 */
function buildBatchSampleIndices(totalChapters: number, perBatch: number): number[][] {
  if (totalChapters <= perBatch) return [[...Array(totalChapters).keys()]];
  // 目标：覆盖全书，每批均匀采样
  // 批次数 = ceil(totalChapters / 间隔)，但限制最多10批避免太多LLM调用
  const maxBatches = Math.min(10, Math.ceil(totalChapters / perBatch));
  const step = totalChapters / (maxBatches * perBatch);
  const batches: number[][] = [];
  for (let b = 0; b < maxBatches; b++) {
    const batch: number[] = [];
    for (let j = 0; j < perBatch; j++) {
      const idx = Math.min(Math.floor((b * perBatch + j) * step), totalChapters - 1);
      if (!batch.includes(idx)) batch.push(idx);
    }
    if (batch.length > 0) batches.push(batch);
  }
  return batches;
}

/** 构建风格指令（基于技巧权重） */
function buildStyleDirective(dna: NovelDNA, weights: Record<string, number>): string {
  const rules: string[] = [];
  const w = weights;

  if (w.hook_strength > 0.7) rules.push('每个场景结尾必须有强力钩子');
  else if (w.hook_strength > 0.4) rules.push('适度使用悬念钩子');
  else rules.push('钩子使用克制，注重自然推进');

  if (w.dialogue_ratio > 0.7) rules.push('大量对话推进剧情，对话占比60%以上');
  else if (w.dialogue_ratio > 0.4) rules.push('对话与叙述均衡');
  else rules.push('以叙述为主，对话精炼');

  if (w.description_density > 0.7) rules.push('浓密的环境和心理描写');
  else if (w.description_density > 0.4) rules.push('适度描写，重点场景详写');
  else rules.push('描写简洁利落');

  if (w.pacing_speed > 0.7) rules.push('极快节奏，每段都有信息量');
  else if (w.pacing_speed > 0.4) rules.push('节奏张弛有度');
  else rules.push('慢节奏铺陈，注重氛围');

  if (w.emotion_intensity > 0.7) rules.push('情感浓烈，角色情绪外放');
  else if (w.emotion_intensity > 0.4) rules.push('情感适度，关键时刻爆发');
  else rules.push('情感内敛克制');

  if (w.conflict_density > 0.7) rules.push('冲突密集，每个场景都有张力');
  else if (w.conflict_density > 0.4) rules.push('冲突节奏合理');
  else rules.push('冲突缓慢积累');

  if (w.humor_level > 0.5) rules.push('适当加入幽默元素');
  if (w.suspense_buildup > 0.7) rules.push('层层递进的悬念铺垫');
  if (w.character_depth > 0.7) rules.push('深入刻画角色内心');
  if (w.scene_transition > 0.7) rules.push('场景切换流畅自然');

  return rules.join('。\n');
}

/** 构建Agent系统提示词 */
function buildAgentSystemPrompt(dna: NovelDNA, styleDirective: string): string {
  return `你是一位专业的网络小说作家，你的任务是模仿一部爆款小说的写作风格来创作内容。

## 目标小说的写作DNA
- 题材：${dna.genre} | 基调：${dna.tone}
- 叙事风格：${dna.narrativeStyle}
- 节奏：${dna.pacing} | 对话：${dna.dialogueStyle} | 描写：${dna.descriptionDensity}
- 情感曲线：${dna.emotionalCurve}
- 开篇技巧：${dna.openingTechnique}
- 悬念风格：${dna.cliffhangerStyle}
- 冲突升级：${dna.conflictEscalation}

## 钩子技巧
${dna.hookTechniques.map(h => `- ${h}`).join('\n')}

## 爽点模式
${dna.satisfactionPatterns.map(s => `- ${s}`).join('\n')}

## 独特写作特征
${dna.uniqueTraits.map(t => `- ${t}`).join('\n')}

## 你的风格指令
${styleDirective}

## 创作规则
1. 严格模仿目标小说的叙事风格和语言习惯
2. 每章目标字数：约${dna.wordCountPerChapter}字
3. 章末必须有悬念或钩子
4. 角色对话要有辨识度
5. 不要生硬模仿，要自然融入风格特征`;
}

/** 构建写作提示词 */
function buildWritingPrompt(dna: NovelDNA, chapter: ChapterContent, prevChapter: ChapterContent | null): string {
  let prompt = `请模仿目标小说的风格，创作与以下原文对应的章节内容。

## 原文参考（第${chapter.number}章：${chapter.title}）
${chapter.content.slice(0, 4000)}${chapter.content.length > 4000 ? '\n...(已截断)' : ''}`;

  if (prevChapter) {
    prompt += `\n\n## 前一章结尾\n${prevChapter.content.slice(-800)}`;
  }

  prompt += `\n\n## 要求\n1. 风格高度一致\n2. 保持相似的叙事节奏和情感强度\n3. 章节字数约${dna.wordCountPerChapter}字\n4. 直接输出正文，不要解释`;
  return prompt;
}

/** 构建阶段写作提示词 */
function buildStageWritingPrompt(dna: NovelDNA, stage: StoryStage): string {
  return `请模仿目标小说的风格，为以下故事阶段创作一段剧本化的内容。

## 故事阶段：${stage.name}
包含章节：${stage.summary}

## 原文参考片段
${stage.excerpt}

## 要求
1. 风格高度一致：语言风格、叙事节奏、对话风格都要贴近原文
2. 以剧本/分镜的思维来写，注重画面感和戏剧冲突
3. 保持原文的情感基调：${dna.emotionalCurve || dna.tone}
4. 字数约${Math.min(dna.wordCountPerChapter, 2000)}字
5. 直接输出正文，不要解释`;
}

/** 批量评选Agent */
async function evaluateAgents(
  projectId: string, chapter: ChapterContent, agents: WritingAgent[], dna: NovelDNA,
  onProgress?: (msg: string) => void,
): Promise<EvalResult[]> {
  const originalExcerpt = chapter.content.slice(0, 3000);
  const BATCH_SIZE = 10;
  const allResults: EvalResult[] = [];

  for (let i = 0; i < agents.length; i += BATCH_SIZE) {
    const batch = agents.slice(i, i + BATCH_SIZE);
    const batchOutputs = batch.map(a => `【Agent ${a.id}】\n${(a.output || '(无输出)').slice(0, 1500)}`).join('\n\n---\n\n');

    const systemPrompt = `你是一位专业的文学评审，擅长对比分析写作风格的相似度。
请对比原文和多个Agent的创作，从6个维度评分（每项0-10分）。
评分标准：
- styleSimilarity：语言风格、用词习惯、句式结构是否接近原文
- narrativeFlow：故事推进是否自然流畅
- hookEffectiveness：悬念设置是否有效
- characterConsistency：角色言行是否符合设定
- emotionalResonance：情感表达是否到位
- overallFidelity：综合还原度
请严格按JSON格式输出。`;

    const userPrompt = `## 原文（第${chapter.number}章）
${originalExcerpt}

## 原文DNA：${dna.narrativeStyle} / ${dna.dialogueStyle} / ${dna.pacing}

## 待评Agent作品
${batchOutputs}

JSON格式：
{
  "evaluations": [
    { "agentId": "ID", "scores": { "styleSimilarity": 7, "narrativeFlow": 8, "hookEffectiveness": 6, "characterConsistency": 7, "emotionalResonance": 7, "overallFidelity": 7 }, "total": 42, "feedback": "简评" }
  ]
}
注意：total = 所有分数之和（满分60）`;

    const result = await llmJSON<{ evaluations: EvalResult[] }>(projectId, `eval_ch${chapter.number}_b${Math.floor(i / BATCH_SIZE)}`, systemPrompt, userPrompt);

    if (result.success && result.data?.evaluations) {
      allResults.push(...result.data.evaluations);
    } else {
      // 评选失败给默认分
      for (const agent of batch) {
        allResults.push({
          agentId: agent.id,
          scores: { styleSimilarity: 3, narrativeFlow: 3, hookEffectiveness: 3, characterConsistency: 3, emotionalResonance: 3, overallFidelity: 3 },
          total: 18, feedback: '评选失败，默认分',
        });
      }
    }
    onProgress?.(`🏅 评分进度: ${Math.min(i + BATCH_SIZE, agents.length)}/${agents.length}（批次${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(agents.length / BATCH_SIZE)}${result.success ? '' : ' ⚠️失败'}）`);
  }
  return allResults;
}

/** 按故事阶段评分（复用evaluateAgents的评分维度） */
async function evaluateAgentsByStage(
  projectId: string, stage: StoryStage, agents: WritingAgent[], dna: NovelDNA,
  onProgress?: (msg: string) => void,
  concurrency: number = 5,
): Promise<EvalResult[]> {
  const BATCH_SIZE = 10;
  const allResults: EvalResult[] = [];
  const totalBatches = Math.ceil(agents.length / BATCH_SIZE);
  let completedBatches = 0;

  const evalSystemPrompt = `你是一位专业的文学评审，擅长对比分析写作风格的相似度。
请对比原文片段和多个Agent的创作，从6个维度评分（每项0-10分）。
评分标准：
- styleSimilarity：语言风格、用词习惯、句式结构是否接近原文
- narrativeFlow：故事推进是否自然流畅
- hookEffectiveness：悬念设置是否有效
- characterConsistency：角色言行是否符合设定
- emotionalResonance：情感表达是否到位
- overallFidelity：综合还原度
请严格按JSON格式输出。`;

  // 构建批次任务
  const batchTasks: Array<() => Promise<EvalResult[]>> = [];
  for (let i = 0; i < agents.length; i += BATCH_SIZE) {
    const batchIdx = Math.floor(i / BATCH_SIZE);
    const batch = agents.slice(i, i + BATCH_SIZE);
    batchTasks.push(async () => {
      const batchOutputs = batch.map(a => `【Agent ${a.id}】\n${(a.output || '(无输出)').slice(0, 1500)}`).join('\n\n---\n\n');
      const userPrompt = `## 原文片段（${stage.name}）
${stage.excerpt.slice(0, 4000)}

## 原文DNA：${dna.narrativeStyle} / ${dna.dialogueStyle} / ${dna.pacing}

## 待评Agent作品
${batchOutputs}

JSON格式：
{
  "evaluations": [
    { "agentId": "ID", "scores": { "styleSimilarity": 7, "narrativeFlow": 8, "hookEffectiveness": 6, "characterConsistency": 7, "emotionalResonance": 7, "overallFidelity": 7 }, "total": 42, "feedback": "简评" }
  ]
}
注意：total = 所有分数之和（满分60）`;

      const result = await llmJSON<{ evaluations: EvalResult[] }>(projectId, `eval_s${stage.index}_b${batchIdx}`, evalSystemPrompt, userPrompt);
      completedBatches++;
      onProgress?.(`🏅 评分进度: ${completedBatches}/${totalBatches} 批（并发${concurrency}${result.success ? '' : ' ⚠️失败'}）`);

      if (result.success && result.data?.evaluations) {
        return result.data.evaluations;
      }
      return batch.map(agent => ({
        agentId: agent.id,
        scores: { styleSimilarity: 3, narrativeFlow: 3, hookEffectiveness: 3, characterConsistency: 3, emotionalResonance: 3, overallFidelity: 3 },
        total: 18, feedback: '评选失败，默认分',
      }));
    });
  }

  const batchResults = await runWithConcurrency(batchTasks, concurrency);
  for (const batch of batchResults) allResults.push(...batch);
  return allResults;
}

/** 分析精英Agent共同特征 */
async function analyzeElites(projectId: string, elites: WritingAgent[], dna: NovelDNA): Promise<string> {
  const eliteInfo = elites.map(e => `Agent ${e.id}（得分${e.score}）: 权重=${JSON.stringify(e.techniqueWeights)}`).join('\n');
  const result = await llmText(projectId, 'analyze_elites',
    '你是AI训练专家，请分析高分Agent的共同特征和可优化方向。',
    `目标: ${dna.genre}/${dna.tone}/${dna.narrativeStyle}\n\n精英:\n${eliteInfo}\n\n请简要分析（200字内）`,
  );
  return result.content || '精英分析不可用';
}

/** 变异Agent */
function mutateAgent(parent: WritingAgent, generation: number, index: number, dna: NovelDNA, _eliteAnalysis: string): WritingAgent {
  const newWeights = { ...parent.techniqueWeights };
  const mutations: string[] = [];
  const dims = Object.keys(newWeights);
  const mutateCount = 2 + Math.floor(Math.random() * 2);
  const selectedDims = dims.sort(() => Math.random() - 0.5).slice(0, mutateCount);

  for (const dim of selectedDims) {
    const delta = (Math.random() - 0.5) * 0.3;
    newWeights[dim] = Math.max(0.05, Math.min(1.0, Math.round((newWeights[dim] + delta) * 100) / 100));
    mutations.push(`${dim}: ${parent.techniqueWeights[dim]}→${newWeights[dim]}`);
  }

  const styleDirective = buildStyleDirective(dna, newWeights);
  return {
    id: `gen${generation}_mut_${String(index).padStart(3, '0')}`, generation, parentId: parent.id,
    systemPrompt: buildAgentSystemPrompt(dna, styleDirective), styleDirective, techniqueWeights: newWeights,
    scoreHistory: [], mutationLog: [...parent.mutationLog, `变异（第${generation}代）: ${mutations.join(', ')}`],
  };
}

/** 交叉两个Agent */
function crossoverAgents(p1: WritingAgent, p2: WritingAgent, generation: number, index: number, dna: NovelDNA): WritingAgent {
  const newWeights: Record<string, number> = {};
  for (const dim of Object.keys(p1.techniqueWeights)) {
    const base = Math.random() > 0.5 ? p1.techniqueWeights[dim] : p2.techniqueWeights[dim];
    newWeights[dim] = Math.max(0.05, Math.min(1.0, Math.round((base + (Math.random() - 0.5) * 0.1) * 100) / 100));
  }
  const styleDirective = buildStyleDirective(dna, newWeights);
  return {
    id: `gen${generation}_cross_${String(index).padStart(3, '0')}`, generation, parentId: `${p1.id}×${p2.id}`,
    systemPrompt: buildAgentSystemPrompt(dna, styleDirective), styleDirective, techniqueWeights: newWeights,
    scoreHistory: [], mutationLog: [`交叉（第${generation}代）: ${p1.id} × ${p2.id}`],
  };
}
