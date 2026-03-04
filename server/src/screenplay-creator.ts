// 剧本创建服务 - 基于 short-drama 方法论的完整剧本创作管道
// 流程: 选题定位 → 创作方案 → 角色开发 → 分集目录 → 分集剧本 → 自检 → 导出
import crypto from 'crypto';
import { chatCompletionJSON, chatCompletion, getLLMConfig, getNextConfig, selectConfig, enhancePromptForNSFW, type LLMConfig, type TaskType } from './llm-service.js';
import { logLLMCall, getAgentById, upsertScreenplayProject, getScreenplayProjectById, listScreenplayProjects as dbListScreenplayProjects, deleteScreenplayProject as dbDeleteScreenplayProject } from './db-service.js';

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
  fixedModel?: LLMConfig | null; // 项目级锁定模型
  nsfw?: boolean;              // NSFW 模式
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

请输出严格的 JSON 格式。`;

  const userPrompt = `创作配置：
- 题材组合：${config.genres.join(' + ')}
- 题材特点：${genreInfo.map(g => `${g.name}（${g.desc}，${g.keyPoints}）`).join('；')}
- 目标受众：${config.audience}
- 故事基调：${config.tone}
- 结局类型：${config.endingType}
- 总集数：${config.totalEpisodes}集
${config.customPrompt ? `- 用户额外要求：${config.customPrompt}` : ''}
${config.referenceNovel ? `\n## 参考小说（基于此小说进行二次创作改编）\n以下是参考小说的内容，请基于其核心故事线、人物关系和情节框架进行短剧改编，但需要适配短剧节奏和格式要求：\n\n${config.referenceNovel.slice(0, 30000)}\n` : ''}

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
  "endingDesign": {"mainLine": "主线结局", "romanceLine": "感情线结局", "foreshadowRecovery": "伏笔回收"}
}

要求：
1. 提供3个剧名备选
2. 三幕结构的集数范围必须覆盖全部${config.totalEpisodes}集
3. 付费卡点约${Math.round(config.totalEpisodes * 0.12)}个
4. 爽点矩阵百分比之和为100`;

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
    "phase": "起势段"
  }
]

要求：
1. 必须覆盖全部${config.totalEpisodes}集
2. 前10集至少3个🔥和2个💰
3. 🔥占比25-35%，💰占比10-15%
4. 每集都有hookType
5. phase必须是：起势段/攀升段/风暴段/决战段`;

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

  const isFirstEpisode = episodeNumber === 1;
  const isDomestic = config.mode === 'domestic';

  // 如果配置了Agent，使用Agent的systemPrompt作为基础
  const agentPrompt = config.agentId ? getAgentById(config.agentId)?.system_prompt : null;

  const systemPrompt = agentPrompt
    ? `${agentPrompt}

## 当前任务：撰写第${episodeNumber}集完整剧本

## 格式要求（${isDomestic ? '国内' : '海外'}模式）
${isDomestic ? `
- 场景头格式：内景/外景 · 地点 · 日/夜
- 镜头标记：△ 全景/中景/近景/特写
- 配乐标记：♪ 音乐描述
- 台词格式：**角色名**（语气/动作指示）："台词"
` : `
- 场景头格式：INT./EXT. LOCATION - DAY/NIGHT
- 镜头标记：WIDE SHOT/MEDIUM SHOT/CLOSE-UP
- 配乐标记：♪ Music cue
- 台词格式：**CHARACTER** (direction): "dialogue"
`}

## 质量要求
- 每集3-5个场次
- 每集800字以上
- 至少使用3种景别
- 台词带语气或动作指示
- 结尾必须有悬念钩子（类型：${dirItem.hookType}）
${isFirstEpisode ? '- 第1集前30秒必须抓住观众（直接进入冲突，禁止大段旁白）' : ''}
${dirItem.mark === '💰' ? '- 付费卡点集：结尾必须制造最强悬念' : ''}

请输出严格的 JSON 格式。`
    : `你是一位专业的微短剧编剧。请撰写第${episodeNumber}集的完整剧本。

## 格式要求（${isDomestic ? '国内' : '海外'}模式）
${isDomestic ? `
- 场景头格式：内景/外景 · 地点 · 日/夜
- 镜头标记：△ 全景/中景/近景/特写
- 配乐标记：♪ 音乐描述
- 台词格式：**角色名**（语气/动作指示）："台词"
` : `
- 场景头格式：INT./EXT. LOCATION - DAY/NIGHT
- 镜头标记：WIDE SHOT/MEDIUM SHOT/CLOSE-UP
- 配乐标记：♪ Music cue
- 台词格式：**CHARACTER** (direction): "dialogue"
`}

## 质量要求
- 每集3-5个场次
- 每集800字以上
- 至少使用3种景别
- 台词带语气或动作指示
- 结尾必须有悬念钩子（类型：${dirItem.hookType}）
${isFirstEpisode ? '- 第1集前30秒必须抓住观众（直接进入冲突，禁止大段旁白）' : ''}
${dirItem.mark === '💰' ? '- 付费卡点集：结尾必须制造最强悬念' : ''}

请输出严格的 JSON 格式。`;

  const userPrompt = `第${episodeNumber}集信息：
- 标题：${dirItem.title}
- 梗概：${dirItem.summary}
- 钩子类型：${dirItem.hookType}
- 标记：${dirItem.mark || '常规'}
- 所属阶段：${dirItem.phase}
${prevHook ? `- 上集钩子：${prevHook}` : ''}

角色简表：
${charBrief}

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
      "description": "△ （全景）场景描写...\\n△ （中景）人物动作...\\n△ （特写）关键细节...",
      "dialogues": [
        {"character": "角色A", "direction": "冷笑", "line": "台词内容"}
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

  // 更新项目
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

请输出完整的改写后剧本，严格 JSON 格式。`;

  const rewriteUserPrompt = `原剧本：
${episodeJSON}

审核评分（总分 ${review.total}/50）：
${dimensionFeedback}

具体问题：
${issuesList}

请根据以上审核意见改写优化这集剧本，输出完整 JSON：
{
  "number": ${episodeNumber},
  "title": "集标题",
  "keywords": ["关键词"],
  "satisfactionType": "爽点类型",
  "previousRecap": "前情提要",
  "scenes": [
    {
      "sceneNumber": 1,
      "location": "内景/外景 · 地点 · 日/夜",
      "characters": ["角色名"],
      "description": "场景描写（含镜头指示 △）",
      "dialogues": [{"character": "角色名", "direction": "表演指示", "line": "台词"}],
      "musicCue": "音乐提示"
    }
  ],
  "endHook": "本集钩子",
  "nextPreview": "下集预告",
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
// 获取题材列表（供前端展示）
// ============================================================

export function getGenreList(): Array<{ key: string; name: string; desc: string; audience: string }> {
  return Object.entries(GENRE_MAP).map(([key, val]) => ({
    key, name: val.name, desc: val.desc, audience: val.audience,
  }));
}
