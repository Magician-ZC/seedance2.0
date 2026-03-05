// 剧本创建服务 - 基于 short-drama 方法论的完整剧本创作管道
// 流程: 选题定位 → 创作方案 → 角色开发 → 分集目录 → 分集剧本 → 自检 → 导出
import crypto from 'crypto';
import { chatCompletionJSON, chatCompletion, getLLMConfig, getNextConfig, selectConfig, enhancePromptForNSFW, type LLMConfig, type TaskType } from './llm-service.js';
import { logLLMCall, getAgentById, upsertScreenplayProject, getScreenplayProjectById, listScreenplayProjects as dbListScreenplayProjects, deleteScreenplayProject as dbDeleteScreenplayProject, listCharacterAgents, type CharacterAgentRow } from './db-service.js';
import { splitNovelIntoChapters, splitTextIntoChunks } from './novel-to-drama.js';

// ============================================================
// 类型定义
// ============================================================

export interface ScreenplayConfig {
  genres: string[];           // 题材组合（最多2个）
  audience: '男频' | '女频' | '全年龄';
  tone: string;               // 故事基调
  endingType: string;          // 结局类型
  totalEpisodes: number;       // 集数
  language: 'zh-CN' | 'en-US';
  mode: 'domestic' | 'overseas';
  customPrompt?: string;       // 用户自定义创作要求
  agentId?: string;            // 可选：使用Agent仓库中的写作Agent
  referenceNovel?: string;     // 可选：参考小说内容（用于二创）
  novelAnalysis?: NovelAnalysisSummary; // 参考小说的深度解析结果（替代原文）
  useCharacterPool?: boolean;  // 是否使用群演仓库驱动角色开发
  useTimeline?: boolean;       // 是否启用跨时代时间线架构（仙侠/穿越/科幻等宏大叙事）
  fixedModel?: LLMConfig | null; // 项目级锁定模型
  nsfw?: boolean;              // NSFW 模式
}

/** 参考小说深度解析摘要 */
interface NovelAnalysisSummary {
  title: string;
  genre: string;
  setting: string;             // 时空背景
  mainCharacters: Array<{ name: string; role: string; description: string; personality: string; motivation: string }>;
  storyLine: string;           // 完整故事线
  plotArcs: string[];          // 主要剧情弧
  climax: string;              // 高潮
  ending: string;              // 大结局
  coreConflict: string;        // 核心冲突
  themes: string[];            // 主题
  emotionalCurve: string;      // 情感曲线
  keyRelationships: string[];  // 关键人物关系
}

export interface CreativePlan {
  titleOptions: Array<{ title: string; description: string }>;
  setting: { era: string; location: string; socialEnv: string; classRelation: string };
  storyLine: string;
  coreConflict: string;
  threeActs: {
    act1: { episodeRange: string; coreEvents: string[]; relationships: string };
    act2: { episodeRange: string; conflicts: string[]; turningPoints: string[] };
    act3: { episodeRange: string; climax: string; ending: string };
  };
  rhythmWave: string;
  paywallPlan: Array<{ episode: number; type: string; suspense: string }>;
  satisfactionMatrix: Record<string, number>;
  endingDesign: { mainLine: string; romanceLine: string; foreshadowRecovery: string };
  // 跨时代时间线架构（useTimeline=true 时生成）
  timelineArcs?: TimelineArcs;
}

/** 跨时代时间线架构 */
export interface TimelineArcs {
  eras: Array<{
    id: string;              // 如 "era_1", "era_2"
    name: string;            // "荒古时代", "遮天时代"
    episodeRange: string;    // "第1-30集"
    setting: { era: string; location: string; socialEnv: string };
    powerSystem?: string;    // 该时代的力量体系/规则
    keyCharacters: string[]; // 该时代的核心角色名
  }>;
  // 伏笔/收线节点图谱
  foreshadowGraph: Array<{
    id: string;
    type: 'plant' | 'callback';  // 埋伏笔 / 收线
    linkedId?: string;            // callback 关联的 plant id
    era: string;                  // 所属时代 id
    episode: number;              // 大致集数
    description: string;          // "荒天帝留下的石刻" / "石刻内容揭晓"
    involvedCharacters: string[];
  }>;
  // 跨时代因果链
  causalChains: Array<{
    name: string;           // "荒天帝布局线", "主角成长线"
    nodes: Array<{ era: string; episode: number; event: string }>;
  }>;
}

export interface ScreenplayCharacter {
  id: string;
  name: string;
  age: string;
  appearance: string;
  personality: string[];
  publicIdentity: string;
  realIdentity: string;
  motivation: string;
  conflictPoint: string;
  satisfactionRole: string;
  catchphrase: string;
  arc: string;
  villainLayer?: number;  // 1-4层反派体系
  // 跨时代角色存在形式（useTimeline 时使用）
  eraPresence?: Array<{
    era: string;           // 时代ID
    identity: string;      // 该时代的身份
    powerLevel: string;    // 该时代的实力层级
    role: 'active' | 'legacy' | 'dormant' | 'reborn'; // 活跃/遗产/沉睡/转世
  }>;
}

export interface CharacterRelationship {
  from: string;
  to: string;
  relation: string;
}

export interface CharacterDesign {
  characters: ScreenplayCharacter[];
  relationships: CharacterRelationship[];
  romanceLine: Array<{ episode: number; event: string }>;
  villainSystem: {
    layer1: ScreenplayCharacter[];
    layer2: ScreenplayCharacter[];
    layer3: ScreenplayCharacter[];
    layer4: ScreenplayCharacter[];
  };
}

export interface EpisodeDirectoryItem {
  number: number;
  title: string;
  summary: string;
  hookType: string;       // 悬念钩/反转钩/情绪钩/信息钩/危机钩
  mark: '' | '🔥' | '💰'; // 关键剧情/付费卡点/常规
  act: string;            // 所属幕
  phase: string;          // 起势段/攀升段/风暴段/决战段
  era?: string;           // 所属时代ID（useTimeline 时使用）
  foreshadows?: string[]; // 本集涉及的伏笔/收线节点ID
}

export interface SceneBlock {
  sceneNumber: number;
  location: string;       // 内景/外景 · 地点 · 日/夜
  characters: string[];
  description: string;    // 场景描写（含镜头指示 △）
  dialogues: Array<{ character: string; direction: string; line: string }>;
  musicCue?: string;
}

export interface EpisodeScript {
  number: number;
  title: string;
  keywords: string[];
  satisfactionType: string;
  previousRecap: string;
  scenes: SceneBlock[];
  endHook: string;
  nextPreview: string;
  phase: string;
  hookType: string;
  mark: string;
}

export interface ReviewScore {
  rhythm: { score: number; comment: string };
  satisfaction: { score: number; comment: string };
  dialogue: { score: number; comment: string };
  format: { score: number; comment: string };
  continuity: { score: number; comment: string };
  total: number;
  issues: Array<{ severity: '严重' | '建议' | '微调'; description: string; suggestion: string }>;
}

// 投稿材料
export interface SubmissionMaterials {
  episodeOutline: string;     // 集纲：每集一行摘要
  ecard: string;              // E-card：项目卡片信息
  characterBios: string;      // 人物小传：每人约300字
  scriptSynopsis: string;     // 剧本大纲：一段话卖点简介
}

// 剧本项目完整数据
export interface ScreenplayProject {
  id: string;
  status: 'init' | 'config_done' | 'plan_done' | 'characters_done' | 'directory_done' | 'writing' | 'review' | 'exported';
  config: ScreenplayConfig;
  creativePlan?: CreativePlan;
  characterDesign?: CharacterDesign;
  episodeDirectory?: EpisodeDirectoryItem[];
  episodes: EpisodeScript[];
  reviews: Record<number, ReviewScore>;
  selectedTitle?: string;
  simulationLogs?: string[];  // 世界观模拟 [SIM] 日志，持久化用于回看和Agent进化
  submissionMaterials?: SubmissionMaterials;  // 投稿材料
  createdAt: number;
  updatedAt: number;
}

// 内存存储
const screenplayProjects = new Map<string, ScreenplayProject>();

// 持久化到数据库
function persistProject(p: ScreenplayProject): void {
  upsertScreenplayProject({
    id: p.id, status: p.status,
    config: JSON.stringify(p.config),
    data: JSON.stringify(p),
    created_at: p.createdAt, updated_at: p.updatedAt,
  });
}

// 启动时从数据库恢复
export function loadScreenplayProjectsFromDB(): void {
  const rows = dbListScreenplayProjects();
  for (const row of rows) {
    try {
      const project = JSON.parse(row.data as string) as ScreenplayProject;
      // 确保 episodes 中每个元素都有有效的 number 字段
      if (Array.isArray(project.episodes)) {
        project.episodes = project.episodes.filter(e => e && typeof e.number === 'number');
      }
      screenplayProjects.set(project.id, project);
    } catch { /* 跳过损坏数据 */ }
  }
  console.log(`[screenplay] 从数据库恢复 ${screenplayProjects.size} 个剧本项目`);
}

// ============================================================
// CRUD 操作
// ============================================================

const MAX_CONCURRENT_PROJECTS = 5;

// 获取进行中的项目数量（未导出/未完成的）
export function getActiveProjectCount(): number {
  let count = 0;
  for (const p of screenplayProjects.values()) {
    if (p.status !== 'exported') count++;
  }
  return count;
}

export function createScreenplay(config: ScreenplayConfig): ScreenplayProject | { error: string } {
  if (getActiveProjectCount() >= MAX_CONCURRENT_PROJECTS) {
    return { error: `最多同时进行${MAX_CONCURRENT_PROJECTS}个剧本项目，请先完成或删除现有项目` };
  }
  const id = crypto.randomUUID();
  const project: ScreenplayProject = {
    id, status: 'config_done', config,
    episodes: [], reviews: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  screenplayProjects.set(id, project);
  persistProject(project);
  return project;
}

export function getScreenplay(id: string): ScreenplayProject | undefined {
  return screenplayProjects.get(id);
}

export function updateScreenplay(id: string, updates: Partial<ScreenplayProject>): ScreenplayProject | undefined {
  const p = screenplayProjects.get(id);
  if (!p) return undefined;
  Object.assign(p, updates, { updatedAt: Date.now() });
  persistProject(p);
  return p;
}

export function listScreenplays(): ScreenplayProject[] {
  return Array.from(screenplayProjects.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeScreenplay(id: string): void {
  screenplayProjects.delete(id);
  dbDeleteScreenplayProject(id);
}

// ============================================================
// LLM 调用辅助
// ============================================================

/** 获取项目的固定模型配置 */
function getProjectFixedModel(projectId: string): LLMConfig | null | undefined {
  const p = screenplayProjects.get(projectId);
  return p?.config?.fixedModel;
}

/** 获取项目的 NSFW 开关 */
function getProjectNsfw(projectId: string): boolean {
  return screenplayProjects.get(projectId)?.config?.nsfw || false;
}

async function llmJSON<T>(projectId: string, step: string, system: string, user: string, taskType: TaskType = 'generate'): Promise<{ success: boolean; data?: T; error?: string }> {
  const nsfw = getProjectNsfw(projectId);
  const config = selectConfig(taskType, getProjectFixedModel(projectId), nsfw);
  const finalSystem = enhancePromptForNSFW(system, nsfw);
  const startTime = Date.now();
  const result = await chatCompletionJSON<T>(finalSystem, user, { config, timeoutMs: 600000 });
  logLLMCall({
    projectId, step, provider: config.provider, model: config.model,
    durationMs: Date.now() - startTime, success: result.success, error: result.error,
  });
  return result;
}

async function llmText(projectId: string, step: string, system: string, user: string, taskType: TaskType = 'generate'): Promise<{ success: boolean; content?: string; error?: string }> {
  const nsfw = getProjectNsfw(projectId);
  const config = selectConfig(taskType, getProjectFixedModel(projectId), nsfw);
  const finalSystem = enhancePromptForNSFW(system, nsfw);
  const startTime = Date.now();
  const result = await chatCompletion(finalSystem, user, { config, timeoutMs: 600000 });
  logLLMCall({
    projectId, step, provider: config.provider, model: config.model,
    durationMs: Date.now() - startTime, success: result.success, error: result.error,
  });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, content: result.content };
}

// ============================================================
// 题材知识库（内嵌核心参考数据，避免运行时读文件）
// ============================================================

const GENRE_MAP: Record<string, { name: string; desc: string; audience: string; keyPoints: string }> = {
  '都市情感': { name: '都市情感', desc: '都市男女的爱恨纠葛与情感博弈', audience: '女频，20-35岁城市女性', keyPoints: '情感纠葛至少三角关系，身份差距制造张力' },
  '霸道总裁': { name: '霸道总裁', desc: '冷面总裁遇上不按常理出牌的她', audience: '女频，18-40岁女性', keyPoints: '男主必须有冷面→独宠的反差弧线，女主不卑不亢' },
  '甜宠': { name: '甜宠', desc: '从头甜到尾的高糖恋爱故事', audience: '女频，18-28岁年轻女性', keyPoints: '甜度持续在线，虐不过三集必须发糖' },
  '重生穿越': { name: '重生穿越', desc: '带着前世记忆或未来知识改写命运', audience: '男女通吃，20-35岁', keyPoints: '重生/穿越后的金手指要明确，改写命运线要有节奏感' },
  '战神归来': { name: '战神归来', desc: '隐藏身份的绝世强者重返都市', audience: '男频，25-45岁男性', keyPoints: '前期受辱蓄力越久，揭露时爽感越强' },
  '古装宫廷': { name: '古装宫廷', desc: '后宫争宠、权谋博弈、帝王心术', audience: '女频，20-40岁女性', keyPoints: '智商在线，每次博弈必须有策略支撑' },
  '励志逆袭': { name: '励志逆袭', desc: '从底层一步步走向巅峰', audience: '男女通吃，20-35岁', keyPoints: '逆袭路径要合理，每一步进阶要有代价和成长' },
  '家庭伦理': { name: '家庭伦理', desc: '家长里短中的人性博弈与亲情考验', audience: '女频，30-50岁', keyPoints: '矛盾要接地气，观众能代入，善恶分明' },
  '萌宝': { name: '萌宝', desc: '天才萌娃牵线搭桥促成姻缘', audience: '女频，25-40岁已婚女性', keyPoints: '萌宝必须聪明伶俐且有记忆点，亲子线和爱情线并行' },
  '悬疑探案': { name: '悬疑探案', desc: '层层迷雾中追查真相', audience: '男女通吃，22-40岁', keyPoints: '每集必须有新线索或新嫌疑人，节奏快不拖沓' },
  '软科幻': { name: '软科幻', desc: '轻度科幻设定下的情感或冒险故事', audience: '男频为主，20-35岁', keyPoints: '科幻只是外壳，核心还是人物情感和冲突' },
  '末日重生': { name: '末日重生', desc: '末世降临，带着前世经验求生逆袭', audience: '男频，20-35岁', keyPoints: '生存压力持续在线，阶段性的安全感→新危机循环' },
  '喜剧': { name: '喜剧', desc: '笑点密集的轻松故事', audience: '全年龄', keyPoints: '每分钟至少一个笑点，节奏轻快不说教' },
};

// 节奏阶段分配
function distributePhases(total: number): { rise: number; climb: number; storm: number; final: number } {
  const rise = Math.round(total * 0.15);
  const climb = Math.round(total * 0.30);
  const storm = Math.round(total * 0.35);
  const final = total - rise - climb - storm;
  return { rise, climb, storm, final };
}

// ============================================================
// 参考小说深度解析（替代直接塞原文）
// ============================================================

/** 对参考小说进行深度解析，提取故事线、角色、结局等结构化信息 */
export async function analyzeReferenceNovel(
  projectId: string,
  novelText: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; analysis?: NovelAnalysisSummary; error?: string }> {
  onProgress?.('📖 开始解析参考小说...');

  // 复用 novel-to-drama 的章节拆分
  const parsed = splitNovelIntoChapters(novelText);
  let chapters: Array<{ number: number; title: string; content: string }>;
  if (parsed.length >= 3) {
    chapters = parsed.map(ch => ({ number: ch.number, title: ch.title, content: ch.content }));
  } else {
    const chunks = splitTextIntoChunks(novelText, 8000);
    chapters = chunks.map((c, i) => ({ number: i + 1, title: `段落${i + 1}`, content: c }));
  }
  onProgress?.(`📖 识别到 ${chapters.length} 个章节，开始采样分析...`);

  // 采样：前3章 + 中间3章 + 后3章（确保覆盖开头、发展、结局）
  const indices: number[] = [];
  const total = chapters.length;
  // 前段
  for (let i = 0; i < Math.min(3, total); i++) indices.push(i);
  // 中段
  const mid = Math.floor(total / 2);
  for (let i = mid - 1; i <= mid + 1 && i < total; i++) if (!indices.includes(i) && i >= 0) indices.push(i);
  // 后段（关键：必须包含最后几章以提取结局）
  for (let i = Math.max(0, total - 3); i < total; i++) if (!indices.includes(i)) indices.push(i);

  const MAX_CHARS = 5000;
  const sampleText = indices.map(i =>
    `【第${chapters[i].number}章：${chapters[i].title}】\n${chapters[i].content.slice(0, MAX_CHARS)}`
  ).join('\n\n---\n\n');

  const system = `你是一位专业的小说分析师。请对以下小说片段进行深度分析，提取完整的故事结构。
注意：采样包含了小说的开头、中间和结尾部分，请据此推断完整的故事线和大结局。

输出严格JSON格式：
{
  "title": "小说标题（从内容推断）",
  "genre": "题材类型",
  "setting": "时空背景描述（时代、地点、社会环境）",
  "mainCharacters": [
    { "name": "角色名", "role": "protagonist/supporting/antagonist", "description": "外貌和身份描述", "personality": "性格特质", "motivation": "核心动机" }
  ],
  "storyLine": "完整故事线概述（300字以上，从开头到结局的完整脉络）",
  "plotArcs": ["主要剧情弧1：描述", "主要剧情弧2：描述", ...],
  "climax": "故事高潮描述（100字以上）",
  "ending": "大结局详细描述（150字以上，包括各主要角色的最终归宿）",
  "coreConflict": "核心冲突描述",
  "themes": ["主题1", "主题2"],
  "emotionalCurve": "全书情感曲线描述（从开头到结尾的情感变化）",
  "keyRelationships": ["角色A与角色B：关系描述", ...]
}

要求：
1. storyLine 必须是完整的故事线，不能只写开头
2. ending 必须详细描述大结局，包括主要角色的命运
3. mainCharacters 只提取主角和重要角色（不超过8个）
4. 每个字段都要详细丰富，不能敷衍`;

  const user = `以下是小说的采样章节（前/中/后各取样，共${indices.length}章，全书${chapters.length}章）：\n\n${sampleText}`;

  onProgress?.('📖 正在深度分析故事结构...');
  const result = await llmJSON<NovelAnalysisSummary>(projectId, 'analyze_reference_novel', system, user, 'parse');
  if (!result.success || !result.data) {
    onProgress?.(`⚠️ 小说解析失败: ${result.error || '未知错误'}`);
    return { success: false, error: result.error || '小说解析失败' };
  }

  onProgress?.(`✅ 小说解析完成 - 「${result.data.title}」`);
  return { success: true, analysis: result.data };
}

// ============================================================
// 步骤1: 生成创作方案
// ============================================================

export async function generateCreativePlan(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; project?: ScreenplayProject; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const { config } = project;
  const genreInfo = config.genres.map(g => GENRE_MAP[g] || { name: g, desc: g, audience: '', keyPoints: '' });
  const phases = distributePhases(config.totalEpisodes);

  onProgress?.('正在生成创作方案...');

  const systemPrompt = `你是一位专业的微短剧编剧，精通短视频平台的爆款短剧创作方法论。
请根据用户提供的创作配置，生成一份完整的创作方案。

## 节奏曲线要求
- 起势段（前15%，约${phases.rise}集）：节奏偏快，密集建立信息，每2-3集一个小高潮
- 攀升段（15%-45%，约${phases.climb}集）：节奏稳定上升，每5-7集一个中高潮，付费卡点密度最高
- 风暴段（45%-80%，约${phases.storm}集）：节奏最快，高潮密集，每3-5集一个大高潮
- 决战段（最后20%，约${phases.final}集）：先紧后收，终极对决是全剧最高潮

## 付费卡点要求
- 总卡点数量：${Math.round(config.totalEpisodes * 0.12)}个左右（占比10-15%）
- 首个卡点在第8-12集
- 卡点间隔至少5集
- 卡点类型：身份揭露/生死一线/情感爆发/反派得逞/真相大白

## 爽点矩阵
5大爽点类型：身份碾压、打脸复仇、逆袭翻盘、情感爆发、悬念揭秘
根据题材合理分配各类型占比。
${config.useTimeline ? `
## 跨时代时间线架构要求
本剧采用跨时代宏大叙事结构，需要设计多个时代/纪元，角色通过因果链跨时代关联。

### 时代划分原则
- 根据总集数合理划分2-5个时代/纪元，每个时代有独立的时空背景和力量体系
- 时代之间通过伏笔/收线、转世/传承、遗迹/预言等方式产生因果关联
- 每个时代都要有自己的核心冲突和高潮，同时服务于全剧的终极主线

### 伏笔/收线图谱要求
- 每个时代至少埋设2-3个伏笔（plant），在后续时代收线（callback）
- 伏笔类型：遗迹线索/预言/封印/血脉传承/器物流转/因果循环
- 收线时机要制造"恍然大悟"的爽感，优先安排在付费卡点或关键剧情集

### 因果链要求
- 至少设计2-3条贯穿多个时代的因果链
- 因果链类型：宿命对决线/传承觉醒线/阴谋揭露线/情感轮回线
- 每条因果链在每个时代都要有至少一个关键节点
` : ''}
请输出严格的 JSON 格式。`;

  const userPrompt = `创作配置：
- 题材组合：${config.genres.join(' + ')}
- 题材特点：${genreInfo.map(g => `${g.name}（${g.desc}，${g.keyPoints}）`).join('；')}
- 目标受众：${config.audience}
- 故事基调：${config.tone}
- 结局类型：${config.endingType}
- 总集数：${config.totalEpisodes}集
${config.customPrompt ? `- 用户额外要求：${config.customPrompt}` : ''}
${config.novelAnalysis ? `\n## 参考小说深度解析（基于此小说进行二次创作改编）
请基于以下解析结果进行短剧改编，保留核心故事线和人物关系，但需要适配短剧节奏和格式要求。

### 原作信息
- 标题：${config.novelAnalysis.title}
- 题材：${config.novelAnalysis.genre}
- 时空背景：${config.novelAnalysis.setting}
- 核心冲突：${config.novelAnalysis.coreConflict}
- 主题：${config.novelAnalysis.themes.join('、')}

### 完整故事线
${config.novelAnalysis.storyLine}

### 主要剧情弧
${config.novelAnalysis.plotArcs.map((a, i) => `${i + 1}. ${a}`).join('\n')}

### 高潮
${config.novelAnalysis.climax}

### 大结局
${config.novelAnalysis.ending}

### 情感曲线
${config.novelAnalysis.emotionalCurve}

### 主要角色
${config.novelAnalysis.mainCharacters.map(c => `- ${c.name}（${c.role}）：${c.description}，性格${c.personality}，动机：${c.motivation}`).join('\n')}

### 关键人物关系
${config.novelAnalysis.keyRelationships.join('\n')}
` : config.referenceNovel ? `\n## 参考小说（基于此小说进行二次创作改编）\n以下是参考小说的内容，请基于其核心故事线、人物关系和情节框架进行短剧改编，但需要适配短剧节奏和格式要求：\n\n${config.referenceNovel.slice(0, 30000)}\n` : ''}

请生成创作方案，JSON 格式如下：
{
  "titleOptions": [{"title": "剧名", "description": "一句话说明"}],
  "setting": {"era": "时代", "location": "地点", "socialEnv": "社会环境", "classRelation": "阶层关系"},
  "storyLine": "一句话故事线",
  "coreConflict": "核心冲突",
  "threeActs": {
    "act1": {"episodeRange": "第1-N集", "coreEvents": ["事件1"], "relationships": "人物关系建立"},
    "act2": {"episodeRange": "第N-M集", "conflicts": ["冲突1"], "turningPoints": ["转折1"]},
    "act3": {"episodeRange": "第M-末集", "climax": "终极对决", "ending": "结局处理"}
  },
  "rhythmWave": "全剧节奏波形描述",
  "paywallPlan": [{"episode": 10, "type": "身份揭露", "suspense": "悬念描述"}],
  "satisfactionMatrix": {"身份碾压": 30, "打脸复仇": 25, "逆袭翻盘": 20, "情感爆发": 15, "悬念揭秘": 10},
  "endingDesign": {"mainLine": "主线结局", "romanceLine": "感情线结局", "foreshadowRecovery": "伏笔回收"}${config.useTimeline ? `,
  "timelineArcs": {
    "eras": [
      {"id": "era_1", "name": "时代名称", "episodeRange": "第1-N集", "setting": {"era": "时代", "location": "地点", "socialEnv": "社会环境"}, "powerSystem": "力量体系描述", "keyCharacters": ["角色名1", "角色名2"]}
    ],
    "foreshadowGraph": [
      {"id": "fs_1", "type": "plant", "era": "era_1", "episode": 5, "description": "伏笔描述", "involvedCharacters": ["角色名"]},
      {"id": "fs_1_cb", "type": "callback", "linkedId": "fs_1", "era": "era_2", "episode": 35, "description": "收线描述", "involvedCharacters": ["角色名"]}
    ],
    "causalChains": [
      {"name": "因果链名称", "nodes": [{"era": "era_1", "episode": 3, "event": "事件描述"}]}
    ]
  }` : ''}
}

要求：
1. 提供3个剧名备选
2. 三幕结构的集数范围必须覆盖全部${config.totalEpisodes}集
3. 付费卡点约${Math.round(config.totalEpisodes * 0.12)}个
4. 爽点矩阵百分比之和为100${config.useTimeline ? `
5. timelineArcs.eras 必须覆盖全部集数，时代之间不能有集数空隙
6. foreshadowGraph 中每个 plant 必须有对应的 callback
7. causalChains 至少2条，每条至少跨越2个时代
8. 每个时代的 keyCharacters 要与该时代的剧情匹配` : ''}`;

  const result = await llmJSON<CreativePlan>(projectId, 'creative_plan', systemPrompt, userPrompt);
  if (!result.success || !result.data) return { success: false, error: result.error || '创作方案生成失败' };

  onProgress?.('创作方案生成完成');
  return { success: true, project: updateScreenplay(projectId, { creativePlan: result.data, status: 'plan_done' }) };
}

// ============================================================
// 步骤2: 角色开发
// ============================================================

export async function generateCharacters(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; project?: ScreenplayProject; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project?.creativePlan) return { success: false, error: '请先生成创作方案' };

  // 如果开启了群演仓库，走群演驱动路径
  if (project.config.useCharacterPool) {
    return generateCharactersFromPool(projectId, onProgress);
  }

  onProgress?.('正在开发角色体系...');

  const { config, creativePlan } = project;

  const systemPrompt = `你是一位专业的微短剧编剧，擅长角色设计。
请根据创作方案设计完整的角色体系。

## 四层反派体系
- 第一层（小反派）：前期炮灰，被主角轻松击败
- 第二层（中反派）：中期主要对手，需要2-3次交锋才能击败
- 第三层（大反派）：终极Boss，实力最强
- 第四层（隐藏反派，可选）：主角身边信任的人，用于终极反转

## 角色设计要求
- 每个角色必须有明确的爽点功能
- 反派必须有合理动机，不能为恶而恶
- 主要角色6-10个，包含主角、爱情线角色、各层反派、关键配角
- 每个角色需要口头禅或语言特征增加辨识度

请输出严格的 JSON 格式。`;

  const userPrompt = `创作方案摘要：
- 题材：${config.genres.join(' + ')}
- 受众：${config.audience}
- 基调：${config.tone}
- 故事线：${creativePlan.storyLine}
- 核心冲突：${creativePlan.coreConflict}
- 时空背景：${creativePlan.setting.era}，${creativePlan.setting.location}，${creativePlan.setting.socialEnv}
- 三幕结构：
  第一幕：${creativePlan.threeActs.act1.coreEvents.join('、')}
  第二幕：${creativePlan.threeActs.act2.conflicts.join('、')}
  第三幕：${creativePlan.threeActs.act3.climax}

请生成角色设计，JSON 格式：
{
  "characters": [
    {
      "id": "C01",
      "name": "角色名",
      "age": "年龄",
      "appearance": "外貌特征2-3句",
      "personality": ["性格关键词1", "性格关键词2"],
      "publicIdentity": "公开身份",
      "realIdentity": "真实身份",
      "motivation": "核心动机",
      "conflictPoint": "最大冲突点",
      "satisfactionRole": "在故事中承担的爽点功能",
      "catchphrase": "口头禅或语言特征",
      "arc": "从第一集到最后一集的变化轨迹",
      "villainLayer": 0
    }
  ],
  "relationships": [
    {"from": "角色A", "to": "角色B", "relation": "关系描述"}
  ],
  "romanceLine": [
    {"episode": 1, "event": "感情线关键节点"}
  ],
  "villainSystem": {
    "layer1": [],
    "layer2": [],
    "layer3": [],
    "layer4": []
  }
}

要求：
1. 主要角色6-10个
2. villainLayer: 0=非反派, 1-4=对应反派层级
3. villainSystem中引用characters数组中的角色（通过id）
4. romanceLine标注具体集数
5. 关系图覆盖所有主要角色间的关系`;

  const result = await llmJSON<CharacterDesign>(projectId, 'character_design', systemPrompt, userPrompt);
  if (!result.success || !result.data) return { success: false, error: result.error || '角色开发失败' };

  onProgress?.('角色体系开发完成');
  return { success: true, project: updateScreenplay(projectId, { characterDesign: result.data, status: 'characters_done' }) };
}

// ============================================================
// 步骤2b: 群演仓库驱动角色开发
// ============================================================

/** 从群演仓库中匹配角色，在世界观中模拟互动，由全知Agent提取最终角色体系 */
async function generateCharactersFromPool(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; project?: ScreenplayProject; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project?.creativePlan) return { success: false, error: '请先生成创作方案' };

  // 收集 [SIM] 日志用于持久化
  const simLogs: string[] = [];
  const emitAndCollect = (msg: string) => {
    if (msg.startsWith('[SIM]')) simLogs.push(msg);
    onProgress?.(msg);
  };

  const { config, creativePlan } = project;

  // ====== 第1步：从群演仓库匹配候选角色 ======
  emitAndCollect('🎭 正在从群演仓库中匹配候选角色...');

  const allAgents = listCharacterAgents();
  if (allAgents.length === 0) {
    emitAndCollect('⚠️ 群演仓库为空，回退到默认角色开发');
    return generateCharactersDefault(projectId, onProgress);
  }

  // 用 LLM 从候选角色中智能匹配
  const candidateSummary = allAgents.slice(0, 200).map(a =>
    `[${a.id}] ${a.name}（${a.role}）| 来源：${a.source_novel} | 分类：${a.category} | 性格：${a.personality?.slice(0, 80)} | 描述：${a.description?.slice(0, 80)}`
  ).join('\n');

  const matchSystem = `你是一位专业的选角导演。请从候选角色库中，为以下剧本选择最合适的角色。

选角原则：
1. 角色的性格、背景要与剧本世界观和题材匹配
2. 都市题材优先选现代背景角色，古装题材优先选古代背景角色，穿越题材可混选
3. 需要有对立关系的角色（正派vs反派）
4. 需要有感情线的角色组合
5. 选择10-100个角色，优先选择描述丰富、性格鲜明的角色
6. 至少选10个，最多100个

输出严格JSON格式：
{ "selectedIds": ["id1", "id2", ...], "reason": "选角理由简述" }`;

  const matchUser = `剧本信息：
- 题材：${config.genres.join(' + ')}
- 受众：${config.audience}
- 基调：${config.tone}
- 故事线：${creativePlan.storyLine}
- 核心冲突：${creativePlan.coreConflict}
- 时空背景：${creativePlan.setting.era}，${creativePlan.setting.location}

候选角色库（共${allAgents.length}个）：
${candidateSummary}`;

  const matchResult = await llmJSON<{ selectedIds: string[]; reason: string }>(projectId, 'match_pool_agents', matchSystem, matchUser, 'parse');

  let selectedAgents: CharacterAgentRow[];
  if (matchResult.success && matchResult.data && matchResult.data.selectedIds && matchResult.data.selectedIds.length >= 10) {
    const idSet = new Set(matchResult.data.selectedIds.slice(0, 100));
    selectedAgents = allAgents.filter(a => idSet.has(a.id));
    emitAndCollect(`✅ 选中 ${selectedAgents.length} 位候选角色（${matchResult.data.reason}）`);
  } else {
    // 降级：按 category 匹配
    const genreKeywords = config.genres.join(' ');
    selectedAgents = allAgents.filter(a =>
      a.category && genreKeywords.includes(a.category) ||
      a.source_novel && genreKeywords.includes(a.source_novel)
    ).slice(0, 50);
    if (selectedAgents.length < 10) selectedAgents = allAgents.slice(0, Math.min(30, allAgents.length));
    emitAndCollect(`⚠️ 智能匹配失败，按分类选中 ${selectedAgents.length} 位候选角色`);
  }

  // ====== 第2步：世界观模拟 - 并发多轮互动，实时推送 ======
  emitAndCollect(`🌍 将 ${selectedAgents.length} 位角色投入世界观中模拟互动...`);

  // 构建角色档案
  const buildProfile = (a: CharacterAgentRow) =>
    `【${a.name}】（${a.role === 'protagonist' ? '主角型' : '配角型'}）\n性格：${a.personality}\n描述：${a.description}\n说话风格：${a.system_prompt?.match(/说话风格[：:](.*?)(?:\n|$)/)?.[1] || '未知'}\n背景：${a.system_prompt?.match(/身份背景[：:](.*?)(?:\n|$)/)?.[1] || a.description?.slice(0, 50)}`;

  const worldSetting = `时代：${creativePlan.setting.era}\n地点：${creativePlan.setting.location}\n社会环境：${creativePlan.setting.socialEnv}\n阶层关系：${creativePlan.setting.classRelation}\n核心冲突：${creativePlan.coreConflict}\n故事线：${creativePlan.storyLine}`;

  // 分组策略：有时间线架构时按时代分组，否则按大小随机分组
  const hasTimeline = config.useTimeline && creativePlan.timelineArcs;
  let groups: CharacterAgentRow[][];
  let eraLabels: string[] = []; // 每组对应的时代名称（仅时间线模式）

  if (hasTimeline && creativePlan.timelineArcs) {
    // 按时代分组：用 LLM 将角色分配到各时代
    const eraNames = creativePlan.timelineArcs.eras.map(e => e.name);
    // 简单策略：均匀分配到各时代，每个时代一组
    const eraCount = eraNames.length;
    const perEra = Math.ceil(selectedAgents.length / eraCount);
    groups = [];
    for (let i = 0; i < eraCount; i++) {
      const start = i * perEra;
      const group = selectedAgents.slice(start, start + perEra);
      if (group.length > 0) {
        groups.push(group);
        eraLabels.push(eraNames[i]);
      }
    }
  } else {
    const groupSize = Math.max(5, Math.min(8, Math.ceil(selectedAgents.length / 4)));
    groups = [];
    for (let i = 0; i < selectedAgents.length; i += groupSize) {
      groups.push(selectedAgents.slice(i, i + groupSize));
    }
  }

  type SimInteraction = { participants: string[]; type: string; description: string; tension: number; storyPotential: string };
  type RoundResult = { interactions: SimInteraction[]; narrative: string };

  // 收集所有角色名（用于前端气泡图）
  const allCharNames = selectedAgents.map(a => a.name);

  // [SIM] 推送开始事件，包含所有角色信息
  emitAndCollect(`[SIM]${JSON.stringify({
    type: 'start',
    totalRounds: groups.length,
    totalAgents: selectedAgents.length,
    world: `${creativePlan.setting.era}·${creativePlan.setting.location}`,
    characters: allCharNames,
  })}`);

  // 并发执行所有轮次模拟
  const roundPromises = groups.map((group, round) => {
    const roundNum = round + 1;
    // 推送本轮开始
    emitAndCollect(`[SIM]${JSON.stringify({
      type: 'round_start', round: roundNum, total: groups.length,
      characters: group.map(a => a.name),
    })}`);

    const roundSystem = `你是一位全知全能的世界观监控者，正在观察一群角色在新世界中的互动。

世界观设定：
${worldSetting}
${hasTimeline && eraLabels[round] && creativePlan.timelineArcs ? (() => {
  const era = creativePlan.timelineArcs!.eras.find(e => e.name === eraLabels[round]);
  return era ? `
## 本组所属时代：${era.name}
- 时空背景：${era.setting.era} · ${era.setting.location} · ${era.setting.socialEnv}
${era.powerSystem ? `- 力量体系：${era.powerSystem}` : ''}
- 注意：角色的行为和互动必须符合这个时代的背景设定` : '';
})() : ''}

你的任务：
1. 以第三人称叙事视角，生动描述这组角色进入世界后的互动场景
2. 每个角色都应该像真实活着的人一样行动，有自己的欲望、恐惧和选择
3. 描述他们的对话、冲突、合作或暧昧关系
4. 注意角色之间的化学反应和戏剧张力
5. 为每个互动事件标注时间线阶段（初遇/发展/转折/高潮），确保事件有时间先后逻辑

输出严格JSON格式：
{
  "narrative": "这组角色互动的叙事描述（300-500字，生动有画面感，包含对话和动作）",
  "interactions": [
    {
      "participants": ["角色A", "角色B"],
      "type": "冲突/合作/暧昧/对抗/依赖/利用",
      "description": "互动描述（50字以上）",
      "tension": 1-10,
      "storyPotential": "这段关系能产生什么样的故事",
      "timeline": "初遇/发展/转折/高潮"
    }
  ]
}`;

    const roundUser = `本轮进入世界的角色（第${roundNum}组，共${groups.length}组）：\n\n${group.map(buildProfile).join('\n\n')}\n\n请模拟这组角色在世界中的互动，注意标注时间线阶段。`;

    return llmJSON<RoundResult & { interactions: Array<SimInteraction & { timeline?: string }> }>(
      projectId, `world_sim_round_${roundNum}`, roundSystem, roundUser, 'generate'
    ).then(result => {
      if (result.success && result.data) {
        // 推送本轮结果
        const narrative = result.data.narrative || '';
        const interactions = result.data.interactions || [];
        emitAndCollect(`[SIM]${JSON.stringify({
          type: 'round_result', round: roundNum, narrative,
          interactions: interactions.map(i => ({
            p: i.participants, t: i.type, d: i.description,
            tension: i.tension, timeline: (i as any).timeline || '发展',
          })),
        })}`);
        return result.data;
      } else {
        emitAndCollect(`[SIM]${JSON.stringify({ type: 'round_fail', round: roundNum })}`);
        return null;
      }
    });
  });

  // 等待所有并发轮次完成
  const roundResults = await Promise.all(roundPromises);
  const allRoundResults = roundResults.filter((r): r is NonNullable<typeof r> => r !== null);

  if (allRoundResults.length === 0) {
    emitAndCollect('⚠️ 世界模拟全部失败，回退到默认角色开发');
    return generateCharactersDefault(projectId, onProgress);
  }

  // ====== 第2.5步：跨组交叉互动（让不同组的角色也产生关系） ======
  emitAndCollect(`[SIM]${JSON.stringify({ type: 'cross_start' })}`);
  emitAndCollect(hasTimeline ? '🔗 正在模拟跨时代因果回响...' : '🔗 正在模拟跨组角色交叉互动...');

  // 从每组中选出张力最高的角色，组成交叉组
  const topCharsPerGroup = allRoundResults.map(r => {
    const charMentions = new Map<string, number>();
    for (const inter of (r.interactions || [])) {
      for (const p of inter.participants) {
        charMentions.set(p, (charMentions.get(p) || 0) + inter.tension);
      }
    }
    return [...charMentions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  }).flat();

  const crossAgents = selectedAgents.filter(a => topCharsPerGroup.includes(a.name));
  let crossInteractions: SimInteraction[] = [];

  if (crossAgents.length >= 4) {
    const crossSystem = hasTimeline && creativePlan.timelineArcs
      ? `你是一位全知全能的世界观监控者。这些角色来自不同的时代/纪元，他们之间存在跨越时空的因果关联。

世界观设定：
${worldSetting}

时代架构：
${creativePlan.timelineArcs!.eras.map(e => `- ${e.name}：${e.setting.era} · ${e.setting.location}`).join('\n')}

之前各时代的互动概要：
${allRoundResults.map((r, i) => `${eraLabels[i] || `第${i + 1}组`}：${r.narrative?.slice(0, 150)}`).join('\n')}

伏笔/收线图谱：
${creativePlan.timelineArcs!.foreshadowGraph.map(f => `- [${f.type === 'plant' ? '伏笔' : '收线'}] ${f.description}（${f.era}）`).join('\n')}

你的任务：模拟这些来自不同时代的角色之间的跨时空关联。关联方式包括：
- 转世/轮回：前世今生的宿命纠葛
- 传承/遗产：前人留下的力量、器物、预言影响后人
- 因果循环：前一个时代的选择导致后一个时代的困境
- 血脉延续：跨时代的家族恩怨
- 封印/沉睡：古代强者在后世苏醒

输出严格JSON格式：
{
  "narrative": "跨时代因果回响叙事（300-500字，要有宿命感和史诗感）",
  "interactions": [
    {
      "participants": ["角色A", "角色B"],
      "type": "转世/传承/因果/血脉/封印/宿敌",
      "description": "跨时代关联描述（100字以上）",
      "tension": 1-10,
      "storyPotential": "这段跨时代关系能产生什么样的故事",
      "timeline": "远古/传承/觉醒/对决"
    }
  ]
}`
      : `你是一位全知全能的世界观监控者。这些角色来自不同的社交圈，现在他们在同一个世界中相遇了。

世界观设定：
${worldSetting}

之前各组的互动概要：
${allRoundResults.map((r, i) => `第${i + 1}组：${r.narrative?.slice(0, 150)}`).join('\n')}

你的任务：模拟这些来自不同圈子的角色之间的交叉互动，重点关注跨圈子的冲突和联盟。

输出严格JSON格式：
{
  "narrative": "跨组互动叙事（200-400字）",
  "interactions": [
    {
      "participants": ["角色A", "角色B"],
      "type": "冲突/合作/暧昧/对抗/依赖/利用",
      "description": "互动描述",
      "tension": 1-10,
      "storyPotential": "故事潜力",
      "timeline": "发展/转折/高潮"
    }
  ]
}`;

    const crossUser = hasTimeline
      ? `跨时代核心角色：\n\n${crossAgents.map(buildProfile).join('\n\n')}\n\n请模拟这些来自不同时代的角色之间的跨时空因果关联。`
      : `跨组交叉角色：\n\n${crossAgents.map(buildProfile).join('\n\n')}\n\n请模拟这些来自不同圈子的角色之间的互动。`;

    const crossResult = await llmJSON<RoundResult>(projectId, 'world_sim_cross', crossSystem, crossUser, 'generate');
    if (crossResult.success && crossResult.data) {
      crossInteractions = crossResult.data.interactions || [];
      emitAndCollect(`[SIM]${JSON.stringify({
        type: 'cross_result',
        narrative: crossResult.data.narrative || '',
        interactions: crossInteractions.map(i => ({
          p: i.participants, t: i.type, d: i.description,
          tension: i.tension, timeline: (i as any).timeline || '转折',
        })),
      })}`);
    }
  }

  emitAndCollect(`[SIM]${JSON.stringify({ type: 'summarizing' })}`);
  emitAndCollect('🔮 正在汇总世界模拟结果...');

  // 汇总模拟
  const allInteractions = [...allRoundResults.flatMap(r => r.interactions || []), ...crossInteractions];
  const allNarratives = allRoundResults.map((r, i) => `【第${i + 1}轮】${r.narrative}`).join('\n\n');

  const summarySystem = `你是一位全知全能的世界观监控者。多轮角色互动模拟已完成，请汇总所有互动结果。

输出严格JSON格式：
{
  "naturalAlliances": [["角色A", "角色B"]],
  "naturalConflicts": [["角色C", "角色D"]],
  "romancePotential": [{"pair": ["角色E", "角色F"], "chemistry": "化学反应描述"}],
  "outcasts": ["不适合这个世界的角色名"],
  "powerDynamics": "权力格局描述",
  "emergentStory": "这群角色在一起会自然产生什么样的故事（200字以上）"
}`;

  const summaryUser = `世界观：${worldSetting}\n\n模拟叙事：\n${allNarratives}\n\n所有互动关系（共${allInteractions.length}组）：\n${allInteractions.map(i => `${i.participants.join(' ↔ ')}（${i.type}，张力${i.tension}/10）：${i.description}`).join('\n')}`;

  const summaryResult = await llmJSON<{
    naturalAlliances: string[][];
    naturalConflicts: string[][];
    romancePotential: Array<{ pair: string[]; chemistry: string }>;
    outcasts: string[];
    powerDynamics: string;
    emergentStory: string;
  }>(projectId, 'world_sim_summary', summarySystem, summaryUser, 'generate');

  const simData = {
    interactions: allInteractions,
    naturalAlliances: summaryResult.data?.naturalAlliances || [],
    naturalConflicts: summaryResult.data?.naturalConflicts || [],
    romancePotential: summaryResult.data?.romancePotential || [],
    outcasts: summaryResult.data?.outcasts || [],
    powerDynamics: summaryResult.data?.powerDynamics || '',
    emergentStory: summaryResult.data?.emergentStory || allNarratives.slice(0, 500),
  };

  emitAndCollect(`[SIM]${JSON.stringify({
    type: 'done', interactions: allInteractions.length,
    alliances: simData.naturalAlliances.length,
    conflicts: simData.naturalConflicts.length,
    romances: simData.romancePotential.length,
  })}`);
  emitAndCollect(`✅ 世界模拟完成 - ${allInteractions.length} 组互动关系`);

  // ====== 第3步：全知Agent提取最终角色体系 ======
  emitAndCollect('👁️ 全知Agent正在从模拟结果中提取最终角色体系...');

  const extractSystem = `你是一位全知全能的故事架构师。基于世界观模拟的结果，你需要从候选角色中提取最终的角色体系。

要求：
1. 选出6-10个最核心的角色，他们之间的关系最有戏剧张力
2. 必须包含四层反派体系（小反派→中反派→大反派→可选隐藏反派）
3. 必须有感情线角色组合
4. 每个角色都要像真实活着的人，有自己的欲望、恐惧和选择
5. 角色的性格和行为要基于原始角色档案，但可以根据新世界观做适当调整
6. 排除那些与世界观格格不入的角色
${hasTimeline && creativePlan.timelineArcs ? `
7. 每个角色必须标注 eraPresence（在各时代的存在形式）
8. 角色可以通过转世/传承/封印/沉睡等方式跨越多个时代
9. 至少有2个角色跨越2个以上时代
10. eraPresence.role 取值：active（活跃）/legacy（遗产影响）/dormant（沉睡/封印）/reborn（转世）` : ''}

输出严格JSON格式（与标准角色设计格式一致）。`;

  const extractUser = `世界观模拟结果：
- 权力格局：${simData.powerDynamics}
- 自然产生的故事：${simData.emergentStory}
- 自然联盟：${simData.naturalAlliances?.map(a => a.join(' & ')).join('；') || '无'}
- 自然冲突：${simData.naturalConflicts?.map(c => c.join(' vs ')).join('；') || '无'}
- 感情线潜力：${simData.romancePotential?.map(r => `${r.pair.join(' ♥ ')}：${r.chemistry}`).join('；') || '无'}
- 不适合的角色：${simData.outcasts?.join('、') || '无'}

关键互动（按张力排序）：
${(simData.interactions || []).sort((a, b) => b.tension - a.tension).slice(0, 15).map(i =>
  `${i.participants.join(' ↔ ')}（${i.type}，张力${i.tension}/10）：${i.description}`
).join('\n')}

剧本要求：
- 题材：${config.genres.join(' + ')}
- 受众：${config.audience}
- 基调：${config.tone}
- 故事线：${creativePlan.storyLine}
- 核心冲突：${creativePlan.coreConflict}
- 总集数：${config.totalEpisodes}集

候选角色原始档案：
${selectedAgents.filter(a => !simData.outcasts?.includes(a.name)).map(a =>
  `${a.name}：${a.personality}，${a.description?.slice(0, 100)}`
).join('\n')}

请从中提取6-10个最终角色，JSON格式：
{
  "characters": [
    {
      "id": "C01",
      "name": "角色名",
      "age": "年龄",
      "appearance": "外貌特征",
      "personality": ["性格关键词1", "性格关键词2"],
      "publicIdentity": "公开身份",
      "realIdentity": "真实身份",
      "motivation": "核心动机",
      "conflictPoint": "最大冲突点",
      "satisfactionRole": "爽点功能",
      "catchphrase": "口头禅",
      "arc": "人物弧光",
      "villainLayer": 0${hasTimeline ? `,
      "eraPresence": [
        {"era": "era_1", "identity": "该时代的身份", "powerLevel": "实力层级", "role": "active"}
      ]` : ''}
    }
  ],
  "relationships": [{"from": "角色A", "to": "角色B", "relation": "关系描述"}],
  "romanceLine": [{"episode": 1, "event": "感情线节点"}],
  "villainSystem": {"layer1": [], "layer2": [], "layer3": [], "layer4": []}
}`;

  const extractResult = await llmJSON<CharacterDesign>(projectId, 'extract_final_characters', extractSystem, extractUser, 'generate');
  if (!extractResult.success || !extractResult.data) {
    emitAndCollect('⚠️ 角色提取失败，回退到默认角色开发');
    return generateCharactersDefault(projectId, onProgress);
  }

  emitAndCollect(`✅ 最终角色体系确定 - ${extractResult.data.characters?.length || 0} 位角色`);
  return { success: true, project: updateScreenplay(projectId, { characterDesign: extractResult.data, simulationLogs: simLogs, status: 'characters_done' }) };
}

/** 默认角色开发（generateCharacters 的原始逻辑提取，用于降级回退） */
async function generateCharactersDefault(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; project?: ScreenplayProject; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project?.creativePlan) return { success: false, error: '请先生成创作方案' };
  // 临时关闭 useCharacterPool 避免递归
  const origConfig = project.config;
  project.config = { ...origConfig, useCharacterPool: false };
  const result = await generateCharacters(projectId, onProgress);
  project.config = origConfig;
  return result;
}

// ============================================================
// 步骤3: 生成分集目录
// ============================================================

export async function generateDirectory(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; project?: ScreenplayProject; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project?.characterDesign) return { success: false, error: '请先完成角色开发' };

  onProgress?.('正在生成分集目录...');

  const { config, creativePlan, characterDesign } = project;
  const phases = distributePhases(config.totalEpisodes);
  const paywallCount = Math.round(config.totalEpisodes * 0.12);
  const keyEpisodeCount = Math.round(config.totalEpisodes * 0.30);

  const systemPrompt = `你是一位专业的微短剧编剧，擅长分集目录规划。

## 节奏要求
- 起势段（第1-${phases.rise}集）：建立角色和冲突，至少3个🔥和2个💰
- 攀升段（第${phases.rise + 1}-${phases.rise + phases.climb}集）：主线展开，付费卡点密度最高
- 风暴段（第${phases.rise + phases.climb + 1}-${phases.rise + phases.climb + phases.storm}集）：高潮密集，核心秘密揭露
- 决战段（第${phases.rise + phases.climb + phases.storm + 1}-${config.totalEpisodes}集）：终极对决，收束结局

## 钩子类型
5种钩子：悬念钩、反转钩、情绪钩、信息钩、危机钩
- 连续3集不用同类型钩子
- 每集结尾必须有钩子

## 标记规则
- 🔥 关键剧情集：占比25-35%（约${keyEpisodeCount}集）
- 💰 付费卡点集：占比10-15%（约${paywallCount}集）
- 无标记：常规推进集
${creativePlan?.timelineArcs ? `
## 跨时代时间线约束
本剧采用跨时代叙事结构，分集目录必须严格遵循时间线架构。

### 时代划分
${creativePlan.timelineArcs.eras.map(e => `- ${e.name}（${e.id}）：${e.episodeRange}，背景：${e.setting.era} · ${e.setting.location}`).join('\n')}

### 伏笔/收线节点（必须在对应集数体现）
${creativePlan.timelineArcs.foreshadowGraph.map(f => `- 第${f.episode}集（${f.era}）[${f.type === 'plant' ? '埋伏笔' : '收线'}]：${f.description}`).join('\n')}

### 因果链节点（必须在对应集数体现）
${creativePlan.timelineArcs.causalChains.map(c => `- ${c.name}：${c.nodes.map(n => `第${n.episode}集(${n.era})${n.event}`).join(' → ')}`).join('\n')}

### 时代切换要求
- 时代切换集必须标记为🔥（关键剧情）
- 切换时使用悬念钩或反转钩制造跨时代悬念
- 每个时代的首集要快速建立新时空的视觉和情感基调
` : ''}
请输出严格的 JSON 数组。`;

  const charSummary = characterDesign!.characters.map(c =>
    `${c.name}（${c.publicIdentity}${c.villainLayer ? `，第${c.villainLayer}层反派` : ''}）`
  ).join('、');

  const userPrompt = `创作方案：
- 故事线：${creativePlan!.storyLine}
- 核心冲突：${creativePlan!.coreConflict}
- 三幕结构：
  第一幕(${creativePlan!.threeActs.act1.episodeRange})：${creativePlan!.threeActs.act1.coreEvents.join('、')}
  第二幕(${creativePlan!.threeActs.act2.episodeRange})：${creativePlan!.threeActs.act2.conflicts.join('、')}
  第三幕(${creativePlan!.threeActs.act3.episodeRange})：${creativePlan!.threeActs.act3.climax}
- 角色：${charSummary}
- 付费卡点规划：${creativePlan!.paywallPlan.map(p => `第${p.episode}集(${p.type})`).join('、')}
- 结局：${creativePlan!.endingDesign.mainLine}

请为全部${config.totalEpisodes}集生成分集目录，JSON 数组格式：
[
  {
    "number": 1,
    "title": "集标题",
    "summary": "核心冲突或爽点一句话描述",
    "hookType": "悬念钩",
    "mark": "🔥",
    "act": "第一幕",
    "phase": "起势段"${creativePlan?.timelineArcs ? `,
    "era": "era_1",
    "foreshadows": ["fs_1"]` : ''}
  }
]

要求：
1. 必须覆盖全部${config.totalEpisodes}集
2. 前10集至少3个🔥和2个💰
3. 🔥占比25-35%，💰占比10-15%
4. 每集都有hookType
5. phase必须是：起势段/攀升段/风暴段/决战段${creativePlan?.timelineArcs ? `
6. 每集必须标注所属时代era（使用时代ID）
7. 涉及伏笔埋设或收线的集数，foreshadows数组中填入对应节点ID
8. 时代切换的集数必须标记为🔥` : ''}`;

  const result = await llmJSON<EpisodeDirectoryItem[]>(projectId, 'episode_directory', systemPrompt, userPrompt);
  if (!result.success || !result.data) return { success: false, error: result.error || '分集目录生成失败' };

  // LLM 可能返回包裹对象 { "directory": [...] } 而非直接数组
  let directory: EpisodeDirectoryItem[] = result.data;
  if (!Array.isArray(directory)) {
    console.log(`[screenplay] directory 非数组, type=${typeof directory}, keys=${Object.keys(directory as object)}`);
    const obj = directory as unknown as Record<string, unknown>;
    const arr = Object.values(obj).find(v => Array.isArray(v)) as EpisodeDirectoryItem[] | undefined;
    if (!arr?.length) return { success: false, error: '分集目录格式异常：LLM未返回数组' };
    directory = arr;
  }
  console.log(`[screenplay] directory生成成功, len=${directory.length}, isArray=${Array.isArray(directory)}`);

  onProgress?.('分集目录生成完成');
  const updated = updateScreenplay(projectId, { episodeDirectory: directory, status: 'directory_done' });
  console.log(`[screenplay] updateScreenplay后 hasDir=${Array.isArray(updated?.episodeDirectory)}, status=${updated?.status}`);
  return { success: true, project: updated };
}

// ============================================================
// 步骤4: 生成分集剧本（支持单集/批量）
// ============================================================

export async function generateEpisode(
  projectId: string,
  episodeNumber: number,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; episode?: EpisodeScript; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project?.episodeDirectory) return { success: false, error: '请先生成分集目录' };

  const dirItem = project.episodeDirectory.find(d => d.number === episodeNumber);
  if (!dirItem) return { success: false, error: `第${episodeNumber}集不在目录中` };

  onProgress?.(`正在撰写第${episodeNumber}集...`);

  const { config, creativePlan, characterDesign } = project;

  // 获取前一集的结尾钩子作为上下文
  const prevEpisode = project.episodes.find(e => e.number === episodeNumber - 1);
  const prevHook = prevEpisode?.endHook || '';

  // 构建角色简表
  const charBrief = characterDesign!.characters.map(c =>
    `${c.name}：${c.publicIdentity}，性格${c.personality.join('/')}，口头禅"${c.catchphrase}"`
  ).join('\n');

  // 从模拟日志中提取角色互动经历，注入写作上下文
  const simContext = (() => {
    const simLogs = project.simulationLogs;
    if (!simLogs?.length) return '';
    const charNames = new Set(characterDesign!.characters.map(c => c.name));
    const interactions: string[] = [];
    for (const log of simLogs) {
      if (!log.startsWith('[SIM]')) continue;
      try {
        const evt = JSON.parse(log.slice(5));
        if (evt.type !== 'round_result' && evt.type !== 'cross_result') continue;
        for (const it of (evt.interactions || [])) {
          if (!it.p?.some((n: string) => charNames.has(n))) continue;
          interactions.push(`${it.p.join(' ↔ ')}（${it.t}，张力${it.tension}/10）：${it.d}`);
        }
      } catch { /* skip */ }
    }
    if (interactions.length === 0) return '';
    // 取最相关的前15条，避免prompt过长
    return `\n## 角色世界观模拟经历（写作时请参考这些真实互动，让角色行为保持一致性）\n${interactions.slice(0, 15).join('\n')}`;
  })();

  const isFirstEpisode = episodeNumber === 1;
  const isDomestic = config.mode === 'domestic';

  // 如果配置了Agent，使用Agent的systemPrompt作为基础
  const agentPrompt = config.agentId ? getAgentById(config.agentId)?.system_prompt : null;

  // 通用格式和质量要求（两个分支共用，避免重复）
  const formatBlock = isDomestic ? `
- 场景头格式：内景/外景 · 地点 · 日/夜
- 镜头标记：△ 全景/中景/近景/特写
- 配乐标记：♪ 音乐描述
- 台词格式：**角色名**（语气/动作指示）："台词"
` : `
- 场景头格式：INT./EXT. LOCATION - DAY/NIGHT
- 镜头标记：WIDE SHOT/MEDIUM SHOT/CLOSE-UP
- 配乐标记：♪ Music cue
- 台词格式：**CHARACTER** (direction): "dialogue"
`;

  const qualityBlock = `## 质量要求（严格执行，微短剧行业标准：1分钟≈250-300字）
- 每集3-5个场次
- 场景描写（description字段）：每个场景50-80字的镜头指示，用2-3个镜头段落（如△全景→△中景→△特写），简洁有画面感，重点写人物动作和关键视觉元素，不要写小说式的大段环境描写
- 台词对话（dialogues数组）：每个场景4-6轮对话，这是微短剧的核心驱动力。每句台词15-30字，要有冲突感和潜台词，带简短的语气/动作指示（如"冷笑"、"猛地转身"）
- 每集总字数600-900字（对应1-3分钟屏幕时间），台词占60-70%，场景描写占30-40%
- 至少使用2种景别
- 节奏要快，每个场景都要推进剧情或制造冲突，禁止无意义的过渡场景
- 结尾必须有悬念钩子（类型：${dirItem.hookType}）
${isFirstEpisode ? '- 第1集前10秒必须抓住观众（直接进入冲突，禁止大段旁白）' : ''}
${dirItem.mark === '💰' ? '- 付费卡点集：结尾必须制造最强悬念' : ''}`;

  const systemPrompt = agentPrompt
    ? `${agentPrompt}

## 当前任务：撰写第${episodeNumber}集完整剧本

## 格式要求（${isDomestic ? '国内' : '海外'}模式）
${formatBlock}

${qualityBlock}

请输出严格的 JSON 格式。`
    : `你是一位专业的微短剧编剧。请撰写第${episodeNumber}集的完整剧本。

## 格式要求（${isDomestic ? '国内' : '海外'}模式）
${formatBlock}

${qualityBlock}

请输出严格的 JSON 格式。`;

  const userPrompt = `第${episodeNumber}集信息：
- 标题：${dirItem.title}
- 梗概：${dirItem.summary}
- 钩子类型：${dirItem.hookType}
- 标记：${dirItem.mark || '常规'}
- 所属阶段：${dirItem.phase}
${prevHook ? `- 上集钩子：${prevHook}` : ''}
${dirItem.era && creativePlan?.timelineArcs ? (() => {
  const era = creativePlan.timelineArcs!.eras.find(e => e.id === dirItem.era);
  const foreshadows = (dirItem.foreshadows || []).map(fid => creativePlan.timelineArcs!.foreshadowGraph.find(f => f.id === fid)).filter(Boolean);
  const chains = creativePlan.timelineArcs!.causalChains.filter(c => c.nodes.some(n => n.era === dirItem.era && Math.abs(n.episode - episodeNumber) <= 1));
  return `
## 时间线上下文
- 所属时代：${era?.name || dirItem.era}（${era?.setting.era} · ${era?.setting.location}）
${era?.powerSystem ? `- 力量体系：${era.powerSystem}` : ''}
${foreshadows.length > 0 ? `- 本集伏笔/收线任务：\n${foreshadows.map(f => `  · [${f!.type === 'plant' ? '埋伏笔' : '收线'}] ${f!.description}（涉及：${f!.involvedCharacters.join('、')}）`).join('\n')}` : ''}
${chains.length > 0 ? `- 本集因果链节点：\n${chains.map(c => `  · ${c.name}：${c.nodes.filter(n => n.era === dirItem.era && Math.abs(n.episode - episodeNumber) <= 1).map(n => n.event).join('、')}`).join('\n')}` : ''}`;
})() : ''}

角色简表：
${charBrief}
${simContext}

故事线：${creativePlan!.storyLine}
核心冲突：${creativePlan!.coreConflict}

请生成完整剧本，JSON 格式：
{
  "number": ${episodeNumber},
  "title": "${dirItem.title}",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "satisfactionType": "爽点类型",
  "previousRecap": "前情提要1-2句",
  "scenes": [
    {
      "sceneNumber": 1,
      "location": "内景 · 客厅 · 日",
      "characters": ["角色A", "角色B"],
      "description": "△ 全景：昏暗客厅，电视蓝光映墙，茶几散落揉皱的文件和冷咖啡。\\n△ 中景：角色A猛地站起，手机屏亮着未读消息，脚步不自觉后退。\\n△ 特写：角色A手指微颤，指甲掐进掌心，眼眶泛红强忍泪水。",
      "dialogues": [
        {"character": "角色A", "direction": "冷笑", "line": "你以为这样就能瞒过所有人？"},
        {"character": "角色B", "direction": "拍桌站起", "line": "真相迟早大白，我不需要瞒任何人。"},
        {"character": "角色A", "direction": "逼近一步，压低声音", "line": "你确定你能承受真相的代价？"},
        {"character": "角色B", "direction": "后退，眼神闪烁", "line": "你在威胁我？"},
        {"character": "角色A", "direction": "转身，轻笑", "line": "选错了边，就没有回头路了。"}
      ],
      "musicCue": "♪ 紧张的弦乐"
    }
  ],
  "endHook": "🎣 本集钩子描述",
  "nextPreview": "📺 下集预告一句话",
  "phase": "${dirItem.phase}",
  "hookType": "${dirItem.hookType}",
  "mark": "${dirItem.mark}"
}`;

  const result = await llmJSON<EpisodeScript>(projectId, `episode_${episodeNumber}`, systemPrompt, userPrompt);
  if (!result.success || !result.data) return { success: false, error: result.error || `第${episodeNumber}集生成失败` };

  // 确保 number 字段正确（LLM 可能返回字符串或缺失）
  result.data.number = episodeNumber;
  result.data.keywords = result.data.keywords || [];

  // 更新项目（按 number 去重后排序）
  const episodes = [...project.episodes.filter(e => e.number !== episodeNumber), result.data].sort((a, b) => a.number - b.number);
  const newStatus = episodes.length >= config.totalEpisodes ? 'review' : 'writing';
  updateScreenplay(projectId, { episodes, status: newStatus });

  onProgress?.(`第${episodeNumber}集撰写完成`);
  return { success: true, episode: result.data };
}

// 批量生成多集
export async function generateEpisodeBatch(
  projectId: string,
  startEp: number,
  endEp: number,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; completed: number[]; errors: Array<{ episode: number; error: string }> }> {
  const completed: number[] = [];
  const errors: Array<{ episode: number; error: string }> = [];

  for (let ep = startEp; ep <= endEp; ep++) {
    onProgress?.(`正在撰写第${ep}集（${ep - startEp + 1}/${endEp - startEp + 1}）...`);
    const result = await generateEpisode(projectId, ep, onProgress);
    if (result.success) {
      completed.push(ep);
    } else {
      errors.push({ episode: ep, error: result.error || '未知错误' });
    }
  }

  return { success: errors.length === 0, completed, errors };
}

// 重试失败/缺失的分集（并发执行，限制并发数）
export async function retryFailedEpisodes(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; missing: number[]; completed: number[]; errors: Array<{ episode: number; error: string }> }> {
  const project = getScreenplay(projectId);
  if (!project?.episodeDirectory) return { success: false, missing: [], completed: [], errors: [{ episode: 0, error: '请先生成分集目录' }] };

  const existingNums = new Set(project.episodes.map(e => e.number));
  const missing = project.episodeDirectory
    .map(d => d.number)
    .filter(n => !existingNums.has(n))
    .sort((a, b) => a - b);

  if (missing.length === 0) return { success: true, missing: [], completed: [], errors: [] };

  onProgress?.(`检测到 ${missing.length} 集缺失：${missing.join(', ')}，开始并发重新生成...`);

  const CONCURRENCY = 5;
  const completed: number[] = [];
  const errors: Array<{ episode: number; error: string }> = [];
  let doneCount = 0;

  // 并发控制：分批执行
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    onProgress?.(`正在并发生成: ${batch.map(n => `第${n}集`).join('、')} (${doneCount}/${missing.length})`);

    const results = await Promise.allSettled(
      batch.map(ep => generateEpisode(projectId, ep, onProgress))
    );

    results.forEach((r, idx) => {
      const ep = batch[idx];
      if (r.status === 'fulfilled' && r.value.success) {
        completed.push(ep);
      } else {
        const errMsg = r.status === 'fulfilled' ? (r.value.error || '未知错误') : String(r.reason);
        errors.push({ episode: ep, error: errMsg });
      }
      doneCount++;
    });

    onProgress?.(`已完成 ${doneCount}/${missing.length}，成功 ${completed.length}，失败 ${errors.length}`);
  }

  return { success: errors.length === 0, missing, completed, errors };
}



// ============================================================
// 步骤5: 质量自检
// ============================================================

export async function reviewEpisode(
  projectId: string,
  episodeNumber: number,
): Promise<{ success: boolean; review?: ReviewScore; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const episode = project.episodes.find(e => e.number === episodeNumber);
  if (!episode) return { success: false, error: `第${episodeNumber}集尚未撰写` };

  // 第一步：审核打分
  const reviewSystemPrompt = `你是一位专业的微短剧质量审核员。请对以下剧本进行五维度质量评分。

## 评分维度（每项1-10分）
1. 节奏：开场是否够快、有无拖沓段落、紧张-舒缓交替是否合理
2. 爽点：数量是否足够、强度是否达标、类型是否多样
3. 台词：有无废话、角色区分度、是否口语化自然
4. 格式：场景头完整性、景别标注、音乐提示、特殊标记
5. 连贯性：与前后集是否矛盾、角色行为是否一致、伏笔是否延续

## 评级标准
- 45-50：卓越，可直接投入拍摄
- 38-44：优良，微调后可用
- 30-37：合格，需要修改特定问题
- 25-29：需改进，存在结构性问题
- <25：需重写

请输出严格的 JSON 格式。`;

  const episodeJSON = JSON.stringify(episode, null, 2);

  const reviewUserPrompt = `请审核以下第${episodeNumber}集剧本：

${episodeJSON}

所属阶段：${episode.phase}
钩子类型：${episode.hookType}
标记：${episode.mark || '常规'}

请输出审核结果，JSON 格式：
{
  "rhythm": {"score": 0, "comment": "从节奏紧凑度、开场速度、拖沓段落等角度具体分析"},
  "satisfaction": {"score": 0, "comment": "从爽点数量、强度、类型多样性等角度具体分析"},
  "dialogue": {"score": 0, "comment": "从台词自然度、角色区分度、废话比例等角度具体分析"},
  "format": {"score": 0, "comment": "从场景头、景别、音乐提示等角度具体分析"},
  "continuity": {"score": 0, "comment": "从前后集衔接、角色一致性、伏笔延续等角度具体分析"},
  "total": 0,
  "issues": [
    {"severity": "建议|警告|严重", "description": "问题描述", "suggestion": "修改建议"}
  ]
}

重要要求：
- score 字段填写你的真实评分（1-10），不要使用示例中的0作为默认值
- total 是五项 score 之和
- 严格按照评级标准打分，不要趋同，该给低分就给低分，该给高分就给高分
- 每集的评分应该有明显差异，反映各集的实际质量差距
- issues 中至少包含2条具体可操作的改进建议`;

  const reviewResult = await llmJSON<ReviewScore>(projectId, `review_${episodeNumber}`, reviewSystemPrompt, reviewUserPrompt, 'evaluate');
  if (!reviewResult.success || !reviewResult.data) return { success: false, error: reviewResult.error || '自检失败' };

  const review = reviewResult.data;

  // 保存审核结果
  const reviews = { ...project.reviews, [episodeNumber]: review };
  updateScreenplay(projectId, { reviews });

  // 第二步：根据审核意见改写剧本并覆盖
  const issuesList = review.issues.map((iss, i) => `${i + 1}. [${iss.severity}] ${iss.description} → ${iss.suggestion}`).join('\n');
  const dimensionFeedback = [
    `节奏(${review.rhythm.score}/10): ${review.rhythm.comment}`,
    `爽点(${review.satisfaction.score}/10): ${review.satisfaction.comment}`,
    `台词(${review.dialogue.score}/10): ${review.dialogue.comment}`,
    `格式(${review.format.score}/10): ${review.format.comment}`,
    `连贯性(${review.continuity.score}/10): ${review.continuity.comment}`,
  ].join('\n');

  const rewriteSystemPrompt = `你是一位专业的微短剧编剧。请根据质量审核意见，对剧本进行针对性改写优化。

## 改写原则
- 只修改审核中指出的问题，保留原剧本的优点和整体结构
- 台词改写要保持角色语气一致性
- 不要改变剧情走向和关键情节点
- 场景数量可以微调但不要大幅增减
- 保持原有的钩子类型和节奏标记

## 质量硬性要求（严格执行，微短剧行业标准：1分钟≈250-300字）
- 每集3-5个场次
- 场景描写（description字段）：每个场景50-80字的镜头指示，用2-3个镜头段落（如△全景→△中景→△特写），简洁有画面感，重点写人物动作和关键视觉元素
- 台词对话（dialogues数组）：每个场景4-6轮对话，这是微短剧的核心驱动力。每句台词15-30字，要有冲突感和潜台词，带简短的语气/动作指示
- 每集总字数600-900字（对应1-3分钟屏幕时间），台词占60-70%，场景描写占30-40%
- 至少使用2种景别
- 节奏要快，每个场景都要推进剧情或制造冲突，禁止无意义的过渡场景
- 结尾必须有悬念钩子
- ⚠️ 改写后的字数不得少于原剧本，只能增加不能缩减

请输出完整的改写后剧本，严格 JSON 格式。`;

  // 统计原剧本的场景数和台词数，作为改写的底线要求
  const origSceneCount = episode.scenes?.length || 0;
  const origDialogueCount = episode.scenes?.reduce((sum, s) => sum + (s.dialogues?.length || 0), 0) || 0;
  const origDescLength = episode.scenes?.reduce((sum, s) => sum + (s.description?.length || 0), 0) || 0;

  const rewriteUserPrompt = `原剧本：
${episodeJSON}

审核评分（总分 ${review.total}/50）：
${dimensionFeedback}

具体问题：
${issuesList}

⚠️ 原剧本统计：${origSceneCount}个场景、${origDialogueCount}轮台词、场景描写共${origDescLength}字
⚠️ 改写后必须保持：场景数≥${origSceneCount}、台词轮数≥${origDialogueCount}、场景描写总字数≥${origDescLength}

请根据以上审核意见改写优化这集剧本，输出完整 JSON：
{
  "number": ${episodeNumber},
  "title": "集标题",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "satisfactionType": "爽点类型",
  "previousRecap": "前情提要1-2句",
  "scenes": [
    {
      "sceneNumber": 1,
      "location": "内景/外景 · 地点 · 日/夜",
      "characters": ["角色A", "角色B"],
      "description": "△（全景）昏暗客厅，电视蓝光映墙，茶几散落揉皱的文件和冷咖啡。\\n△（中景）角色A猛地站起，手机屏亮着未读消息，脚步不自觉后退。\\n△（特写）角色A手指微颤，指甲掐进掌心，眼眶泛红强忍泪水。",
      "dialogues": [
        {"character": "角色A", "direction": "冷笑", "line": "你以为这样就能瞒过所有人？"},
        {"character": "角色B", "direction": "拍桌站起", "line": "真相迟早大白，我不需要瞒任何人。"},
        {"character": "角色A", "direction": "逼近一步，压低声音", "line": "你确定你能承受真相的代价？"},
        {"character": "角色B", "direction": "后退，眼神闪烁", "line": "你在威胁我？"},
        {"character": "角色A", "direction": "转身，轻笑", "line": "选错了边，就没有回头路了。"}
      ],
      "musicCue": "♪ 紧张的弦乐"
    }
  ],
  "endHook": "🎣 本集钩子描述",
  "nextPreview": "📺 下集预告一句话",
  "phase": "${episode.phase}",
  "hookType": "${episode.hookType}",
  "mark": "${episode.mark || ''}"
}`;

  const rewriteResult = await llmJSON<EpisodeScript>(projectId, `rewrite_${episodeNumber}`, rewriteSystemPrompt, rewriteUserPrompt, 'optimize');
  if (rewriteResult.success && rewriteResult.data) {
    const rewritten = rewriteResult.data;
    rewritten.number = episodeNumber;
    rewritten.phase = episode.phase;
    rewritten.hookType = episode.hookType;
    rewritten.mark = episode.mark;

    // 字数缩水检查：改写后的台词数和场景描写不能大幅缩水（允许10%浮动）
    const newDialogueCount = rewritten.scenes?.reduce((sum, s) => sum + (s.dialogues?.length || 0), 0) || 0;
    const newDescLength = rewritten.scenes?.reduce((sum, s) => sum + (s.description?.length || 0), 0) || 0;
    const shrunk = newDialogueCount < origDialogueCount * 0.7 || newDescLength < origDescLength * 0.7;
    if (shrunk) {
      console.log(`[screenplay] 第${episodeNumber}集改写缩水: 台词${origDialogueCount}→${newDialogueCount}, 描写${origDescLength}→${newDescLength}字 ❌ 拒绝`);
      // 缩水严重 → 保留原剧本
      return { success: true, review };
    }

    // 对改写后的剧本重新评分
    const reReviewResult = await llmJSON<ReviewScore>(projectId, `re_review_${episodeNumber}`, reviewSystemPrompt,
      reviewUserPrompt.replace(episodeJSON, JSON.stringify(rewritten, null, 2)), 'evaluate');

    if (reReviewResult.success && reReviewResult.data) {
      const newReview = reReviewResult.data;
      if (newReview.total >= review.total) {
        // 分数不低于原分 → 采纳改写
        const episodes = project.episodes.map(e => e.number === episodeNumber ? rewritten : e);
        const reviews = { ...project.reviews, [episodeNumber]: newReview };
        updateScreenplay(projectId, { episodes, reviews });
        console.log(`[screenplay] 第${episodeNumber}集优化: ${review.total} → ${newReview.total} ✅ 采纳`);
        return { success: true, review: newReview };
      } else {
        // 分数下降 → 再尝试一次改写
        console.log(`[screenplay] 第${episodeNumber}集优化: ${review.total} → ${newReview.total} ↓ 分数下降，重试...`);
        const retryResult = await llmJSON<EpisodeScript>(projectId, `rewrite_retry_${episodeNumber}`, rewriteSystemPrompt,
          rewriteUserPrompt + `\n\n⚠️ 上一次改写后评分从 ${review.total} 降到了 ${newReview.total}，请更谨慎地修改，只改必须改的问题，保留原剧本的优点。`, 'optimize');
        if (retryResult.success && retryResult.data) {
          const retryEp = retryResult.data;
          retryEp.number = episodeNumber;
          retryEp.phase = episode.phase;
          retryEp.hookType = episode.hookType;
          retryEp.mark = episode.mark;
          // 重试版本字数缩水检查
          const retryDialogues = retryEp.scenes?.reduce((sum, s) => sum + (s.dialogues?.length || 0), 0) || 0;
          const retryDescLen = retryEp.scenes?.reduce((sum, s) => sum + (s.description?.length || 0), 0) || 0;
          if (retryDialogues < origDialogueCount * 0.7 || retryDescLen < origDescLength * 0.7) {
            console.log(`[screenplay] 第${episodeNumber}集重试改写缩水: 台词${origDialogueCount}→${retryDialogues}, 描写${origDescLength}→${retryDescLen}字 ❌ 拒绝`);
          } else {
            // 重试版本再评分
            const retryReview = await llmJSON<ReviewScore>(projectId, `re_review_retry_${episodeNumber}`, reviewSystemPrompt,
              reviewUserPrompt.replace(episodeJSON, JSON.stringify(retryEp, null, 2)), 'evaluate');
            if (retryReview.success && retryReview.data && retryReview.data.total >= review.total) {
              const episodes = project.episodes.map(e => e.number === episodeNumber ? retryEp : e);
              const reviews = { ...project.reviews, [episodeNumber]: retryReview.data };
              updateScreenplay(projectId, { episodes, reviews });
              console.log(`[screenplay] 第${episodeNumber}集重试优化: ${review.total} → ${retryReview.data.total} ✅ 采纳`);
              return { success: true, review: retryReview.data };
            }
          }
        }
        // 重试也失败或分数仍下降 → 保留原剧本，保留原评分
        console.log(`[screenplay] 第${episodeNumber}集重试仍未提升，保留原剧本 (${review.total}/50)`);
      }
    }
  }

  return { success: true, review };
}

// ============================================================
// 步骤6: 导出完整剧本
// ============================================================

export function exportScreenplay(projectId: string): { success: boolean; content?: string; error?: string } {
  const project = getScreenplay(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const { config, creativePlan, characterDesign, episodes } = project;
  const title = project.selectedTitle || creativePlan?.titleOptions?.[0]?.title || '未命名剧本';
  const isDomestic = config.mode === 'domestic';

  let md = `# ${title}\n\n`;

  // 元信息
  md += `## 元信息\n\n`;
  md += `| 项目 | 内容 |\n|------|------|\n`;
  md += `| 类型 | ${config.genres.join(' + ')} |\n`;
  md += `| 集数 | ${episodes.length}/${config.totalEpisodes} |\n`;
  md += `| 单集时长 | 约1-3分钟 |\n`;
  md += `| 目标受众 | ${config.audience} |\n`;
  md += `| 故事基调 | ${config.tone} |\n`;
  md += `| 总字数 | ${episodes.reduce((sum, ep) => sum + JSON.stringify(ep).length, 0)} |\n`;
  md += `| 创作日期 | ${new Date(project.createdAt).toLocaleDateString('zh-CN')} |\n\n`;

  // 故事梗概
  if (creativePlan) {
    md += `## 故事梗概\n\n${creativePlan.storyLine}\n\n`;
    md += `核心冲突：${creativePlan.coreConflict}\n\n`;
  }

  // 主要角色
  if (characterDesign) {
    md += `## 主要角色\n\n`;
    for (const char of characterDesign.characters) {
      md += `### ${char.name}\n`;
      md += `- 年龄：${char.age}\n`;
      md += `- 身份：${char.publicIdentity}\n`;
      md += `- 性格：${char.personality.join('、')}\n`;
      md += `- 口头禅：${char.catchphrase}\n\n`;
    }
  }

  // 分集剧本
  md += `## 分集剧本\n\n`;
  for (const ep of episodes) {
    md += `### 第${ep.number}集：${ep.title}\n\n`;
    md += `> 本集关键词：${ep.keywords.join('、')}\n`;
    md += `> 本集爽点：${ep.satisfactionType}\n`;
    if (ep.previousRecap) md += `> 前情提要：${ep.previousRecap}\n`;
    md += `\n---\n\n`;

    for (const scene of ep.scenes) {
      md += `## 场次${scene.sceneNumber}\n\n`;
      md += `**场景：** ${scene.location}\n`;
      md += `**出场人物：** ${scene.characters.join('、')}\n\n`;
      md += `${scene.description}\n\n`;
      for (const d of scene.dialogues) {
        md += `**${d.character}**（${d.direction}）："${d.line}"\n\n`;
      }
      if (scene.musicCue) md += `${scene.musicCue}\n\n`;
      md += `---\n\n`;
    }

    md += `> 🎣 本集钩子：${ep.endHook}\n`;
    md += `> 📺 下集预告：${ep.nextPreview}\n\n`;
  }

  updateScreenplay(projectId, { status: 'exported' });
  return { success: true, content: md };
}

// ============================================================
// 生成投稿材料（集纲 / E-card / 人物小传 / 剧本大纲）
// ============================================================

export async function generateSubmissionMaterials(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; materials?: SubmissionMaterials; error?: string }> {
  const project = getScreenplay(projectId);
  if (!project) return { success: false, error: '项目不存在' };

  const { config, creativePlan, characterDesign, episodeDirectory, episodes } = project;
  const title = project.selectedTitle || creativePlan?.titleOptions?.[0]?.title || '未命名剧本';

  // ---- 1. 集纲：从已有 episodeDirectory 直接组装 ----
  onProgress?.('正在生成集纲...');
  let episodeOutline = `# ${title} · 集纲\n\n`;
  if (episodeDirectory?.length) {
    for (const ep of episodeDirectory) {
      const mark = ep.mark ? ` ${ep.mark}` : '';
      episodeOutline += `第${ep.number}集「${ep.title}」${mark}：${ep.summary}\n`;
    }
  } else if (episodes.length) {
    for (const ep of episodes) {
      episodeOutline += `第${ep.number}集「${ep.title}」：${ep.scenes.map(s => s.description).join('；')}\n`;
    }
  }

  // ---- 2. E-card：从 config + creativePlan 组装 ----
  onProgress?.('正在生成 E-card...');
  const genres = config.genres.join(' / ');
  const epCount = config.totalEpisodes;
  const storyLine = creativePlan?.storyLine || '';
  const coreConflict = creativePlan?.coreConflict || '';
  const setting = creativePlan?.setting;
  const topSatisfaction = creativePlan?.satisfactionMatrix
    ? Object.entries(creativePlan.satisfactionMatrix).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join('、')
    : '';

  let ecard = `# ${title} · E-card\n\n`;
  ecard += `| 项目 | 内容 |\n|------|------|\n`;
  ecard += `| 剧名 | ${title} |\n`;
  ecard += `| 类型 | ${genres} |\n`;
  ecard += `| 集数 | ${epCount}集 |\n`;
  ecard += `| 单集时长 | 约1-3分钟 |\n`;
  ecard += `| 受众 | ${config.audience} |\n`;
  ecard += `| 基调 | ${config.tone} |\n`;
  if (setting) ecard += `| 时空背景 | ${setting.era} · ${setting.location} |\n`;
  ecard += `| 故事线 | ${storyLine} |\n`;
  ecard += `| 核心冲突 | ${coreConflict} |\n`;
  if (topSatisfaction) ecard += `| 核心爽点 | ${topSatisfaction} |\n`;
  ecard += `| 结局类型 | ${config.endingType} |\n`;

  // ---- 3. 人物小传：需要 LLM 生成 ----
  onProgress?.('正在生成人物小传...');
  let characterBios = `# ${title} · 人物小传\n\n`;
  if (characterDesign?.characters?.length) {
    const charNames = characterDesign.characters.map(c => c.name);
    const charSummaries = characterDesign.characters.map(c =>
      `${c.name}（${c.age}岁，${c.publicIdentity}）：性格${c.personality.join('、')}，外貌${c.appearance}，动机：${c.motivation}，人物弧光：${c.arc}，口头禅：${c.catchphrase}，真实身份：${c.realIdentity}，冲突点：${c.conflictPoint}`
    ).join('\n');

    const bioResult = await llmText(projectId, 'submission_bios',
      `你是一位专业的短剧策划编辑。请根据角色资料，为每个角色撰写约300字的人物小传。
要求：
- 每个角色独立一段，以"【角色名】"开头
- 包含：名称、角色定位、外貌形象描写、性格特点、核心故事线/人物弧光
- 语言生动有画面感，适合投稿给平台方审阅
- 不要用列表格式，用流畅的叙述体
- 【严格约束】必须且只能使用以下角色名：${charNames.join('、')}。禁止自创角色名或修改角色名`,
      `剧名：${title}\n类型：${genres}\n故事线：${storyLine}\n\n角色资料：\n${charSummaries}`
    );
    if (bioResult.success && bioResult.content) {
      characterBios += bioResult.content;
    } else {
      // 降级：用已有数据拼接
      for (const c of characterDesign.characters) {
        characterBios += `【${c.name}】${c.age}岁，${c.publicIdentity}。${c.appearance}。性格${c.personality.join('、')}。${c.motivation}。${c.arc}\n\n`;
      }
    }
  }

  // ---- 4. 剧本大纲：需要 LLM 生成 ----
  onProgress?.('正在生成剧本大纲...');
  let scriptSynopsis = `# ${title} · 剧本大纲\n\n`;
  const threeActs = creativePlan?.threeActs;
  const ending = creativePlan?.endingDesign;

  // 提取角色名列表供大纲使用
  const allCharNames = characterDesign?.characters?.map(c => c.name) || [];

  const synopsisContext = [
    `剧名：${title}`,
    `类型：${genres}，${config.audience}`,
    allCharNames.length ? `角色名（必须使用这些名字）：${allCharNames.join('、')}` : '',
    `故事线：${storyLine}`,
    `核心冲突：${coreConflict}`,
    threeActs ? `三幕结构：第一幕${threeActs.act1.coreEvents.join('、')}；第二幕冲突${threeActs.act2.conflicts.join('、')}，转折${threeActs.act2.turningPoints.join('、')}；第三幕${threeActs.act3.climax}` : '',
    ending ? `结局：${ending.mainLine}，感情线${ending.romanceLine}` : '',
    topSatisfaction ? `核心爽点：${topSatisfaction}` : '',
  ].filter(Boolean).join('\n');

  const synopsisResult = await llmText(projectId, 'submission_synopsis',
    `你是一位专业的短剧策划编辑。请撰写一段剧本大纲/项目简介，用于投稿给短剧平台。
要求：
- 300-500字，一段话讲清楚整个故事
- 突出亮点、爽点、反转等吸引人的元素
- 风格类似小说简介/网文简介，有悬念感和吸引力
- 结尾留一个钩子，让审稿人想看完整剧本
- 不要分段，不要用标题，就是一整段流畅的文字
- 【严格约束】文中提到的所有角色必须使用用户提供的角色名，禁止自创或修改任何角色名`,
    synopsisContext
  );
  if (synopsisResult.success && synopsisResult.content) {
    scriptSynopsis += synopsisResult.content;
  } else {
    // 降级
    scriptSynopsis += `${storyLine} ${coreConflict}`;
  }

  const materials: SubmissionMaterials = { episodeOutline, ecard, characterBios, scriptSynopsis };
  updateScreenplay(projectId, { submissionMaterials: materials, status: 'exported' });
  onProgress?.('投稿材料生成完成');
  return { success: true, materials };
}

// ============================================================
// 获取题材列表（供前端展示）
// ============================================================

export function getGenreList(): Array<{ key: string; name: string; desc: string; audience: string }> {
  return Object.entries(GENRE_MAP).map(([key, val]) => ({
    key, name: val.name, desc: val.desc, audience: val.audience,
  }));
}
