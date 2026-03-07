/**
 * arena-engine.ts — 竞技引擎：系统Agent组长 + 变体组员生成
 * 
 * 10个系统Agent各自担任一个创作组的组长，每组派生4个变体组员，共50人。
 * 变体组员通过"风格基因变异"机制，在组长风格基础上融合其他系统Agent的部分维度。
 */

import { SYSTEM_AGENTS, type SystemAgent } from './system-agents-data.js';
import { chatCompletionJSON } from './llm-service.js';
import {
  getScreenplay,
  getActsFromPlan,
  type CreativePlan,
  type CharacterDesign,
  type ScreenplayConfig,
  type EpisodeDirectoryItem,
  type EpisodeScript,
} from './screenplay-creator.js';

// ============ 类型定义 ============

/** 风格基因：从系统Agent的systemPrompt中提取的5个创作维度 */
export interface StyleGene {
  baseStyleId: string;
  narrativeStructure: string;   // 叙事结构偏好
  characterMethod: string;      // 角色塑造方法
  dialogueStyle: string;        // 对白风格
  emotionRhythm: string;        // 情绪节奏
  hookDesign: string;           // 钩子设计
}

/** 创作Agent（组长或组员） */
export interface WriterAgent {
  id: string;
  name: string;
  groupId: string;
  isLeader: boolean;
  systemAgentId: string;
  styleGene: StyleGene;
  systemPrompt: string;
}

/** 创作组：1个组长 + N个变体组员 */
export interface WriterGroup {
  id: string;
  leader: WriterAgent;
  members: WriterAgent[];
  systemAgentId: string;
  systemAgentName: string;
}

// ============ 工具函数 ============

/** Fisher-Yates 洗牌算法 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============ 核心函数 ============

/**
 * 正则提取【xxx】段落内容
 * 从systemPrompt中提取指定section名称的内容
 */
export function extractSection(prompt: string, sectionName: string): string {
  const regex = new RegExp(`【${sectionName}】\\n([\\s\\S]*?)(?=\\n【|$)`);
  const match = prompt.match(regex);
  return match?.[1]?.trim() || '';
}

/**
 * 从系统Agent的systemPrompt中提取5个基因维度
 */
export function extractStyleGene(agent: SystemAgent): StyleGene {
  const prompt = agent.systemPrompt;
  return {
    baseStyleId: agent.id,
    narrativeStructure: extractSection(prompt, '叙事结构偏好'),
    characterMethod: extractSection(prompt, '角色塑造方法'),
    dialogueStyle: extractSection(prompt, '对白风格'),
    emotionRhythm: extractSection(prompt, '情绪节奏'),
    hookDesign: extractSection(prompt, '钩子设计'),
  };
}

/** StyleGene中可变异的5个维度key */
const STYLE_DIMS: (keyof Omit<StyleGene, 'baseStyleId'>)[] = [
  'narrativeStructure', 'characterMethod', 'dialogueStyle', 'emotionRhythm', 'hookDesign',
];

/**
 * 变异：随机选1-2个维度，用其他系统Agent的对应基因替换或融合
 * @param base 基础风格基因（来自组长）
 * @param allAgents 所有系统Agent（用于提供donor基因）
 */
export function mutateStyleGene(base: StyleGene, allAgents: SystemAgent[]): StyleGene {
  const gene = { ...base };
  // 随机选1-2个维度进行变异
  const mutCount = 1 + Math.floor(Math.random() * 2);
  const selected = shuffle(STYLE_DIMS).slice(0, mutCount);

  for (const dim of selected) {
    // 从所有系统Agent中随机选一个donor
    const donor = allAgents[Math.floor(Math.random() * allAgents.length)];
    const donorGene = extractStyleGene(donor);
    // 50%概率直接替换，50%概率融合
    gene[dim] = Math.random() > 0.5
      ? donorGene[dim]
      : `${gene[dim]}\n同时融合：${donorGene[dim].slice(0, 200)}`;
  }
  return gene;
}

/**
 * 将StyleGene编译为完整的创作Agent systemPrompt
 */
export function compileWriterPrompt(gene: StyleGene): string {
  return `你是一位专业的微短剧编剧。以下是你的创作风格指导：

【叙事结构偏好】
${gene.narrativeStructure}

【角色塑造方法】
${gene.characterMethod}

【对白风格】
${gene.dialogueStyle}

【情绪节奏】
${gene.emotionRhythm}

【钩子设计】
${gene.hookDesign}

请严格按照以上风格指导进行创作。`;
}

/**
 * 系统Agent题材匹配关键词映射
 * 每个Agent的genre/tone对应可匹配的题材关键词
 */
const AGENT_GENRE_KEYWORDS: Record<string, string[]> = {
  'sys-01': ['复仇', '女频', '逆袭', '宫斗', '宅斗', '重生', '虐渣'],
  'sys-02': ['现实', '都市', '职场', '家庭', '社会', '文艺', '生活'],
  'sys-03': [], // 全题材通用，始终匹配
  'sys-04': [], // 流量算法通用，始终匹配
  'sys-05': ['马甲', '身份', '隐藏', '豪门', '总裁', '逆袭', '打脸', '都市'],
  'sys-06': ['男频', '战神', '热血', '修仙', '玄幻', '武道', '末世', '系统', '觉醒'],
  'sys-07': ['虐恋', '情感', '爱情', '破碎', '错过', '遗憾', '悲剧', '女频'],
  'sys-08': ['奇幻', '玄幻', '仙侠', '穿越', '异世界', '魔法', '科幻', '末世'],
  'sys-09': ['甜宠', '恋爱', '甜蜜', '校园', '青春', '暖', '治愈', '女频'],
  'sys-10': ['解构', '讽刺', '喜剧', '搞笑', '脑洞', '反套路', '实验'],
  'sys-11': ['重生', '逆袭', '改命', '穿越', '前世', '宿命', '时空', '重活'],
  'sys-12': ['玄幻', '修仙', '仙尊', '武道', '大帝', '圣王', '魔帝', '越阶', '境界'],
  'sys-13': ['奇幻', '脑洞', '规则', '天幕', '异能', '设定', '穿越', '平行世界'],
  'sys-14': ['都市', '专家', '神医', '律师', '商战', '职场', '马甲', '豪门', '警神'],
  'sys-15': ['末世', '灵异', '诡异', '生存', '丧尸', '变异', '恐怖', '废土'],
  'sys-16': ['历史', '年代', '种田', '穿越', '古代', '大明', '民国', '建设'],
  'sys-17': ['系统', '面板', '升级', '转职', '觉醒', '数值', '任务', '抽奖', '开箱'],
  'sys-18': ['千金', '换嫁', '身份', '错位', '冒名', '豪门', '认亲', '女频', '归位'],
};

/** 通用型Agent ID（不受题材限制，始终作为组长） */
const UNIVERSAL_AGENT_IDS = new Set(['sys-03', 'sys-04']);

// ============ 双层Agent体系：骨架 + 灵魂 ============

/** 风格灵魂Agent（sys-01~10）：注入创作风格、语言质感、情绪调性 */
const STYLE_AGENT_IDS = new Set([
  'sys-01', 'sys-02', 'sys-03', 'sys-04', 'sys-05',
  'sys-06', 'sys-07', 'sys-08', 'sys-09', 'sys-10',
]);

/** 题材骨架Agent（sys-11~18）：定义叙事逻辑、结构框架、题材规则 */
const GENRE_AGENT_IDS = new Set([
  'sys-11', 'sys-12', 'sys-13', 'sys-14', 'sys-15', 'sys-16', 'sys-17', 'sys-18',
]);

/** 获取风格Agent列表 */
export function getStyleAgents(): SystemAgent[] {
  return SYSTEM_AGENTS.filter(a => STYLE_AGENT_IDS.has(a.id));
}

/** 获取骨架Agent列表 */
export function getGenreAgents(): SystemAgent[] {
  return SYSTEM_AGENTS.filter(a => GENRE_AGENT_IDS.has(a.id));
}

/**
 * 融合双层Prompt："逻辑定型，风格润色"
 * 骨架Agent提供叙事结构、钩子设计等逻辑框架
 * 风格Agent提供对白风格、情绪节奏等创作调性
 * @param genreAgent 骨架Agent（sys-11~18）
 * @param styleAgent 风格Agent（sys-01~10）
 */
export function compileHybridPrompt(genreAgent: SystemAgent, styleAgent: SystemAgent): string {
  const genreGene = extractStyleGene(genreAgent);
  const styleGene = extractStyleGene(styleAgent);

  return `你是一位专业的微短剧编剧，同时具备精准的题材把控力和独特的创作风格。

## 第一层：题材骨架（来自「${genreAgent.name}」—— ${genreAgent.genre}）
以下是你的题材逻辑框架，决定了剧本的叙事结构和核心机制：

【叙事结构偏好】
${genreGene.narrativeStructure}

【钩子设计】
${genreGene.hookDesign}

## 第二层：风格灵魂（来自「${styleAgent.name}」—— ${styleAgent.genre}/${styleAgent.tone}）
以下是你的创作风格指导，决定了剧本的语言质感和情绪调性：

【角色塑造方法】
${styleGene.characterMethod}

【对白风格】
${styleGene.dialogueStyle}

【情绪节奏】
${styleGene.emotionRhythm}

## 创作原则
- 叙事结构和钩子设计严格遵循题材骨架的逻辑框架
- 角色塑造、对白和情绪节奏融入风格灵魂的创作调性
- 两层之间如有冲突，题材骨架的结构逻辑优先，风格灵魂负责润色表达

请严格按照以上双层指导进行创作。`;
}

/**
 * 融合StyleGene：骨架Agent提供结构维度，风格Agent提供表达维度
 */
export function hybridStyleGene(genreAgent: SystemAgent, styleAgent: SystemAgent): StyleGene {
  const genreGene = extractStyleGene(genreAgent);
  const styleGene = extractStyleGene(styleAgent);
  return {
    baseStyleId: `${genreAgent.id}+${styleAgent.id}`,
    narrativeStructure: genreGene.narrativeStructure,  // 骨架定结构
    characterMethod: styleGene.characterMethod,         // 灵魂定角色
    dialogueStyle: styleGene.dialogueStyle,             // 灵魂定对白
    emotionRhythm: styleGene.emotionRhythm,             // 灵魂定节奏
    hookDesign: genreGene.hookDesign,                    // 骨架定钩子
  };
}

/**
 * 计算系统Agent与题材的匹配度
 * @returns 'strong' 强匹配 | 'universal' 通用型 | 'weak' 弱匹配
 */
export function matchAgentToGenres(
  agent: SystemAgent,
  genres: string[],
): 'strong' | 'universal' | 'weak' {
  if (UNIVERSAL_AGENT_IDS.has(agent.id)) return 'universal';
  if (!genres || genres.length === 0) return 'universal'; // 无题材信息时全部视为通用

  const keywords = AGENT_GENRE_KEYWORDS[agent.id] || [];
  if (keywords.length === 0) return 'universal';

  const genreStr = genres.join(' ').toLowerCase();
  const agentGenreStr = `${agent.genre} ${agent.tone}`.toLowerCase();

  // 检查题材关键词是否命中
  const hit = keywords.some(kw => genreStr.includes(kw)) ||
    genres.some(g => agentGenreStr.includes(g.toLowerCase()));

  return hit ? 'strong' : 'weak';
}

/**
 * 根据题材匹配度对系统Agent排序分组
 * 现在同时考虑骨架Agent和风格Agent的匹配度
 */
export function rankAgentsByGenreMatch(
  genres: string[],
): { leaders: SystemAgent[]; supporters: SystemAgent[] } {
  const strong: SystemAgent[] = [];
  const universal: SystemAgent[] = [];
  const weak: SystemAgent[] = [];

  for (const agent of SYSTEM_AGENTS) {
    const match = matchAgentToGenres(agent, genres);
    if (match === 'strong') strong.push(agent);
    else if (match === 'universal') universal.push(agent);
    else weak.push(agent);
  }

  const leaders = [...strong, ...universal, ...weak];
  return { leaders, supporters: [] };
}

/**
 * 为骨架Agent匹配最合适的风格Agent列表（按题材匹配度排序）
 * @param genres 当前剧本的题材列表
 * @returns 排序后的风格Agent列表（强匹配优先）
 */
function rankStyleAgentsForGenres(genres: string[]): SystemAgent[] {
  const styleAgents = getStyleAgents();
  if (!genres || genres.length === 0) return shuffle(styleAgents);

  const strong: SystemAgent[] = [];
  const universal: SystemAgent[] = [];
  const weak: SystemAgent[] = [];

  for (const agent of styleAgents) {
    const match = matchAgentToGenres(agent, genres);
    if (match === 'strong') strong.push(agent);
    else if (match === 'universal') universal.push(agent);
    else weak.push(agent);
  }

  // 强匹配优先，同级内随机排列
  return [...shuffle(strong), ...shuffle(universal), ...shuffle(weak)];
}

/**
 * 为骨架Agent匹配最合适的骨架Agent列表（按题材匹配度排序）
 * @param genres 当前剧本的题材列表
 * @returns 排序后的骨架Agent列表（强匹配优先）
 */
function rankGenreAgentsForGenres(genres: string[]): SystemAgent[] {
  const genreAgents = getGenreAgents();
  if (!genres || genres.length === 0) return shuffle(genreAgents);

  const strong: SystemAgent[] = [];
  const weak: SystemAgent[] = [];

  for (const agent of genreAgents) {
    const match = matchAgentToGenres(agent, genres);
    if (match === 'strong') strong.push(agent);
    else weak.push(agent);
  }

  return [...shuffle(strong), ...shuffle(weak)];
}

/**
 * 组建创作组：双层Agent体系 —— "逻辑定型，风格润色"
 * 
 * 骨架Agent（sys-11~18）作为组的核心，定义题材逻辑框架
 * 风格Agent（sys-01~10）注入创作灵魂，提供语言质感和情绪调性
 * 
 * 每组结构：
 * - 组长：骨架Agent + 最匹配的风格Agent 融合prompt
 * - 变体组员：同一骨架Agent + 不同风格Agent 的融合变体
 * 
 * @param membersPerGroup 每组基础变体组员数，默认4
 * @param genres 当前剧本的题材列表（可选）
 */
export function buildWriterGroups(membersPerGroup = 4, genres?: string[]): WriterGroup[] {
  // 按题材匹配度排序骨架Agent和风格Agent
  const rankedGenreAgents = genres?.length ? rankGenreAgentsForGenres(genres) : shuffle(getGenreAgents());
  const rankedStyleAgents = genres?.length ? rankStyleAgentsForGenres(genres) : shuffle(getStyleAgents());

  // 计算每个骨架Agent的题材匹配度
  const genreMatchMap = new Map<string, 'strong' | 'universal' | 'weak'>();
  for (const agent of rankedGenreAgents) {
    genreMatchMap.set(agent.id, genres?.length ? matchAgentToGenres(agent, genres) : 'universal');
  }

  // 根据匹配度调整每组的组员数：强匹配+1，弱匹配-1
  const totalBudget = rankedGenreAgents.length * membersPerGroup;
  const memberAlloc = new Map<string, number>();
  let allocated = 0;

  for (const agent of rankedGenreAgents) {
    const match = genreMatchMap.get(agent.id)!;
    let count: number;
    if (match === 'strong') count = membersPerGroup + 1;
    else if (match === 'weak') count = Math.max(1, membersPerGroup - 1);
    else count = membersPerGroup;
    memberAlloc.set(agent.id, count);
    allocated += count;
  }

  // 修正总数
  const diff = allocated - totalBudget;
  if (diff !== 0) {
    const adjustableIds = rankedGenreAgents
      .filter(a => genreMatchMap.get(a.id) !== 'strong')
      .map(a => a.id);
    let remaining = Math.abs(diff);
    for (const uid of adjustableIds) {
      if (remaining <= 0) break;
      const cur = memberAlloc.get(uid)!;
      const adj = diff > 0 ? -1 : 1;
      memberAlloc.set(uid, Math.max(1, cur + adj));
      remaining--;
    }
  }

  return rankedGenreAgents.map((genreAgent, groupIdx) => {
    const groupId = `group-${genreAgent.id}`;
    const groupMemberCount = memberAlloc.get(genreAgent.id) || membersPerGroup;

    // 为组长选择最匹配的风格Agent（循环分配，确保风格多样性）
    const leaderStyleAgent = rankedStyleAgents[groupIdx % rankedStyleAgents.length];
    const hybridGene = hybridStyleGene(genreAgent, leaderStyleAgent);

    // 组长：骨架 + 最匹配风格 的融合prompt
    const leader: WriterAgent = {
      id: `leader-${genreAgent.id}`,
      name: `${genreAgent.name}×${leaderStyleAgent.name}·组长`,
      groupId,
      isLeader: true,
      systemAgentId: genreAgent.id,
      styleGene: hybridGene,
      systemPrompt: compileHybridPrompt(genreAgent, leaderStyleAgent),
    };

    // 变体组员：同一骨架 + 不同风格Agent 的融合变体
    const members: WriterAgent[] = [];
    for (let i = 0; i < groupMemberCount; i++) {
      // 循环选择不同的风格Agent，跳过组长已用的
      const styleIdx = (groupIdx + i + 1) % rankedStyleAgents.length;
      const memberStyleAgent = rankedStyleAgents[styleIdx];
      const memberGene = hybridStyleGene(genreAgent, memberStyleAgent);

      // 在融合基因基础上做轻微变异，增加多样性
      const mutatedGene = mutateStyleGene(memberGene, getStyleAgents());

      members.push({
        id: `member-${genreAgent.id}-${i}`,
        name: `${genreAgent.name}×${memberStyleAgent.name}·变体${i + 1}`,
        groupId,
        isLeader: false,
        systemAgentId: genreAgent.id,
        styleGene: mutatedGene,
        systemPrompt: compileWriterPrompt(mutatedGene),
      });
    }

    return {
      id: groupId,
      leader,
      members,
      systemAgentId: genreAgent.id,
      systemAgentName: genreAgent.name,
    };
  });
}

// Re-export for convenience
export { SYSTEM_AGENTS, type SystemAgent };


// ============ 评审Agent专业体系 ============

/** 漏斗阶段类型 */
export type FunnelStage = 'creative_plan' | 'character' | 'directory' | 'episode';

/** 评审方向定义 */
export interface ReviewDirection {
  id: string;
  name: string;
  weight: number;
  systemPrompt: string;
  activeStages: FunnelStage[];
}

/** 评审Agent */
export interface ReviewerAgent {
  id: string;
  directionId: string;
  directionName: string;
  systemPrompt: string;
  weight: number;
}

/** 单方向评分结果 */
export interface DirectionScore {
  directionId: string;
  directionName: string;
  rawScores: number[];
  medianScore: number;
  weight: number;
  comments?: string[];
}

/** 候选条目（泛型） */
export interface CandidateEntry<T> {
  id: string;
  writerId: string;
  groupId: string;
  systemAgentId: string;
  systemAgentName: string;
  parentCandidateId?: string;
  data: T;
  characterPoolIds?: string[];
  score: number;
  rank?: number;
  directionScores?: DirectionScore[];
  selected?: boolean;
}

/** 10个专业评审方向 */
export const REVIEW_DIRECTIONS: ReviewDirection[] = [
  {
    id: 'plot_structure',
    name: '剧情结构专家',
    weight: 0.15,
    activeStages: ['creative_plan', 'directory', 'episode'],
    systemPrompt: `你是一位资深的剧情结构分析师，专精微短剧的叙事架构评审。

评审维度：
1. 主线清晰度：核心冲突是否明确，主线是否一目了然
2. 节点设计：起承转合是否合理，关键转折是否有力
3. 伏笔与回收：伏笔埋设是否巧妙，回收是否令人满意
4. 逻辑自洽：剧情推进是否合理，有无逻辑硬伤
5. 结构创新：是否有突破常规的叙事手法

请对候选作品的剧情结构进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'characterization',
    name: '人物塑造专家',
    weight: 0.12,
    activeStages: ['character', 'episode'],
    systemPrompt: `你是一位专精角色心理学的编剧顾问，擅长评估微短剧中的人物塑造质量。

评审维度：
1. 角色辨识度：主要角色是否有鲜明的个性标签
2. 动机合理性：角色行为是否有充分的内在动机驱动
3. 成长弧线：角色是否有可信的变化和成长
4. 关系张力：角色之间的关系是否有戏剧张力
5. 共情度：观众是否能与角色产生情感连接

请对候选作品的人物塑造进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'dialogue_quality',
    name: '对白质量专家',
    weight: 0.10,
    activeStages: ['episode'],
    systemPrompt: `你是一位台词功力深厚的对白专家，专注评估微短剧的对白质量。

评审维度：
1. 口语化程度：对白是否自然流畅，符合角色身份
2. 信息密度：每句台词是否承载了足够的叙事信息
3. 潜台词：是否有言外之意，增加对白层次感
4. 金句率：是否有令人印象深刻的经典台词
5. 节奏感：对白长短交替是否有韵律感

请对候选作品的对白质量进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'pacing',
    name: '节奏把控专家',
    weight: 0.12,
    activeStages: ['directory', 'episode'],
    systemPrompt: `你是一位精通短剧节奏设计的节奏大师，擅长评估微短剧的叙事节奏。

评审维度：
1. 开篇吸引力：前3分钟是否能抓住观众注意力
2. 钩子密度：每集是否有足够的悬念钩子
3. 高潮分布：情绪高潮点是否分布合理
4. 付费卡点：关键付费节点是否设置在最佳位置
5. 整体节奏曲线：张弛有度，避免拖沓或过于紧凑

请对候选作品的节奏把控进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'commercial_potential',
    name: '商业潜力专家',
    weight: 0.15,
    activeStages: ['creative_plan', 'directory', 'episode'],
    systemPrompt: `你是一位短剧平台的资深商业分析师，专注评估微短剧的商业变现潜力。

评审维度：
1. 题材热度：题材是否符合当前市场趋势和用户偏好
2. 付费驱动力：是否有足够强的付费动机设计
3. 目标受众匹配：内容是否精准匹配目标用户群体
4. 传播潜力：是否有引发社交传播的爆点元素
5. 续集/IP潜力：是否有延展为系列IP的空间

请对候选作品的商业潜力进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'creativity',
    name: '创意新颖度专家',
    weight: 0.10,
    activeStages: ['creative_plan', 'episode'],
    systemPrompt: `你是一位追求创新的先锋编剧评论家，专注评估微短剧的创意新颖度。

评审维度：
1. 题材新颖性：是否有独特的切入角度或世界观设定
2. 反套路程度：是否打破了常见的短剧套路和模式
3. 概念原创性：核心概念是否有原创性
4. 融合创新：是否巧妙融合了不同类型元素
5. 惊喜感：是否有出人意料的创意亮点

请对候选作品的创意新颖度进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'emotional_resonance',
    name: '情感共鸣专家',
    weight: 0.10,
    activeStages: ['character', 'episode'],
    systemPrompt: `你是一位深谙观众心理的情感分析师，专注评估微短剧的情感共鸣效果。

评审维度：
1. 情感触发点：是否有明确的情感触发设计
2. 代入感：观众是否容易代入角色处境
3. 情绪层次：情感表达是否有层次递进
4. 虐爽平衡：虐心与爽感的比例是否恰当
5. 情感余韵：看完后是否有持续的情感回味

请对候选作品的情感共鸣效果进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'visual_narrative',
    name: '视觉叙事专家',
    weight: 0.08,
    activeStages: ['episode'],
    systemPrompt: `你是一位精通视觉语言的导演型编剧，专注评估微短剧剧本的视觉叙事质量。

评审维度：
1. 场景画面感：文字描述是否能让人脑补出清晰画面
2. 镜头语言暗示：是否有巧妙的镜头运用提示
3. 视觉符号：是否运用了有意义的视觉符号和意象
4. 场景转换：场景切换是否流畅自然
5. 视觉冲击力：是否有令人印象深刻的视觉场面

请对候选作品的视觉叙事质量进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'compliance',
    name: '合规审核专家',
    weight: 0.03,
    activeStages: ['episode'],
    systemPrompt: `你是一位短剧平台的内容合规审核员，专注评估微短剧内容的合规性。

评审维度：
1. 价值观导向：内容是否传递积极正面的价值观
2. 敏感内容：是否存在暴力、色情等敏感内容越界
3. 法律风险：是否存在侵权、诽谤等法律风险
4. 平台规范：是否符合主流短剧平台的内容规范
5. 社会影响：内容是否可能引发负面社会影响

请对候选作品的合规性进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
  {
    id: 'production_feasibility',
    name: '综合制片专家',
    weight: 0.05,
    activeStages: ['episode'],
    systemPrompt: `你是一位经验丰富的短剧制片人，专注评估微短剧的制作可行性。

评审维度：
1. 场景复杂度：场景数量和转换是否在合理范围内
2. 演员需求：角色数量和表演难度是否可控
3. 特效需求：是否需要大量特效，成本是否合理
4. 拍摄周期：按当前剧本预估的拍摄周期是否合理
5. 性价比：投入产出比是否有竞争力

请对候选作品的制作可行性进行专业评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`,
  },
];


/** 各阶段激活的评审方向映射 */
export const STAGE_REVIEW_MAP: Record<FunnelStage, string[]> = {
  creative_plan: ['plot_structure', 'commercial_potential', 'creativity'],
  character: ['characterization', 'emotional_resonance'],
  directory: ['pacing', 'commercial_potential', 'plot_structure'],
  episode: [
    'plot_structure', 'characterization', 'dialogue_quality', 'pacing',
    'commercial_potential', 'creativity', 'emotional_resonance',
    'visual_narrative', 'compliance', 'production_feasibility',
  ],
};


// ============ 评审核心函数 ============

/**
 * 生成评审Agent：每个方向5人，共50人
 * @param reviewersPerDirection 每方向评审人数，默认5
 */
export function generateReviewerAgents(reviewersPerDirection = 5): ReviewerAgent[] {
  const agents: ReviewerAgent[] = [];
  for (const direction of REVIEW_DIRECTIONS) {
    for (let i = 0; i < reviewersPerDirection; i++) {
      agents.push({
        id: `reviewer-${direction.id}-${i}`,
        directionId: direction.id,
        directionName: direction.name,
        systemPrompt: direction.systemPrompt,
        weight: direction.weight,
      });
    }
  }
  return agents;
}

/**
 * 中位数计算
 * 排序后取中间值；偶数个元素取中间两个的平均值
 */
export function calculateMedian(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 单个评审Agent执行评审，调用LLM返回评分+点评
 * @returns { score, comment } 或 null（失败时）
 */
export async function executeSingleReview(
  projectId: string,
  candidate: CandidateEntry<unknown>,
  reviewer: ReviewerAgent,
  stage: FunnelStage,
): Promise<{ score: number; comment: string } | null> {
  const userPrompt = `请对以下${stage}阶段的候选作品进行专业评审。

候选作品ID: ${candidate.id}
创作组: ${candidate.systemAgentName}
阶段: ${stage}

作品内容:
${JSON.stringify(candidate.data, null, 2)}

请严格按照你的专业评审维度进行评分（0-10分），并给出具体点评。
输出JSON格式：{"score": 数字, "comment": "点评内容"}`;

  try {
    const result = await chatCompletionJSON<{ score: number; comment: string }>(
      reviewer.systemPrompt,
      userPrompt,
    );
    if (!result.success || !result.data) return null;

    // 将评分钳制到 [0, 10] 范围
    const score = Math.max(0, Math.min(10, result.data.score));
    return { score, comment: result.data.comment || '' };
  } catch {
    return null;
  }
}

/** 按指定key对数组分组 */
function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}

/**
 * 通用评审函数：对一个候选产出进行多方向评审
 * 按方向分组 → 每方向并发评审 → 取中位数 → 权重归一化 → 加权汇总
 *
 * @param projectId 项目ID
 * @param candidate 候选条目
 * @param reviewers 参与评审的ReviewerAgent列表（已按阶段过滤）
 * @param stage 当前漏斗阶段
 * @param scheduler 可选的并发调度器（传入时使用队列调度，否则直接Promise.all）
 */
export async function reviewCandidate(
  projectId: string,
  candidate: CandidateEntry<unknown>,
  reviewers: ReviewerAgent[],
  stage: FunnelStage,
): Promise<number> {
  // 按方向分组
  const byDirection = groupBy(reviewers, r => r.directionId);
  const directionScores: DirectionScore[] = [];

  for (const [dirId, dirReviewers] of Object.entries(byDirection)) {
    // 同方向Agent并发评审
    const results = await Promise.all(
      dirReviewers.map(reviewer =>
        executeSingleReview(projectId, candidate, reviewer, stage),
      ),
    );

    const validResults = results.filter((r): r is { score: number; comment: string } => r !== null);
    const validScores = validResults.map(r => r.score);

    if (validScores.length >= 3) {
      const median = calculateMedian(validScores);
      const direction = REVIEW_DIRECTIONS.find(d => d.id === dirId)!;
      directionScores.push({
        directionId: dirId,
        directionName: direction.name,
        rawScores: validScores,
        medianScore: median,
        weight: direction.weight,
        comments: validResults.map(r => r.comment),
      });
    }
  }

  // 加权综合评分（激活方向权重归一化后求和）
  const totalWeight = directionScores.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedTotal = directionScores.reduce(
    (s, d) => s + d.medianScore * (d.weight / totalWeight),
    0,
  );

  // 将评分结果挂到候选条目上
  candidate.directionScores = directionScores;

  return weightedTotal;
}

/**
 * 通用筛选函数：按分组取Top N
 * @param candidates 候选列表
 * @param groupKey 分组字段名
 * @param topN 每组保留的数量
 */
export function selectBestPerGroup<T>(
  candidates: CandidateEntry<T>[],
  groupKey: keyof CandidateEntry<T>,
  topN: number,
): CandidateEntry<T>[] {
  const groups = groupBy(candidates, c => String(c[groupKey]));
  const result: CandidateEntry<T>[] = [];

  for (const items of Object.values(groups)) {
    // 按分数降序排列
    const sorted = [...items].sort((a, b) => b.score - a.score);
    // 取Top N并标记排名
    const selected = sorted.slice(0, topN);
    for (let i = 0; i < selected.length; i++) {
      selected[i].rank = i + 1;
      selected[i].selected = i === 0; // 每组第一名默认选中
    }
    result.push(...selected);
  }

  // 最终按分数降序排列
  return result.sort((a, b) => b.score - a.score);
}


// ============ 竞技引擎主编排（任务5） ============

import { QueueScheduler } from './queue-scheduler.js';
import { wsManager } from './ws-manager.js';
import {
  createArenaSession,
  getArenaSessionByProjectId,
  updateArenaSession,
  batchInsertArenaWriters,
  batchInsertArenaReviewers,
  batchInsertArenaCandidates,
  batchInsertArenaReviews,
  batchInsertArenaFunnelScores,
  listArenaWritersBySession,
  listArenaCandidatesByStage,
  listArenaFunnelScoresByStage,
  updateArenaFunnelScoreSelected,
  listCharacterAgents,
  type CharacterAgentRow,
  type ArenaSessionRow,
  type ArenaWriterRow,
  type ArenaReviewerRow,
  type ArenaCandidateRow,
  type ArenaReviewRow,
  type ArenaFunnelScoreRow,
} from './db-service.js';

// ============ 竞技配置类型 ============

/** 竞技模式配置 */
export interface ArenaConfig {
  groupCount: number;           // 固定10
  membersPerGroup: number;      // 默认4
  strictness: 'standard' | 'strict' | 'extreme';
  concurrency: number;          // 默认5
  passScore: number;            // standard=5.5, strict=6.0, extreme=7.0
}

/** 阶段候选集合 */
export interface StageCandidates<T> {
  stage: FunnelStage;
  candidates: CandidateEntry<T>[];
  totalGenerated: number;
  totalSurvived: number;
}

/** 竞技状态（API返回） */
export interface ArenaStatus {
  sessionId: string;
  projectId: string;
  config: ArenaConfig;
  status: string;
  currentStage: FunnelStage | null;
  groups: ArenaGroupInfo[];
  stages: {
    creative_plan?: StageStatus;
    character?: StageStatus;
    directory?: StageStatus;
    episode?: StageStatus;
  };
  taskId: string;
}

/** 创作组概览信息 */
export interface ArenaGroupInfo {
  groupId: string;
  systemAgentId: string;
  systemAgentName: string;
  leaderName: string;
  memberCount: number;
}

/** 阶段状态 */
export interface StageStatus {
  status: 'pending' | 'creating' | 'reviewing' | 'selecting' | 'completed';
  totalCandidates: number;
  survivedCandidates: number;
  selectedCandidateId?: string;
  progress: string;
}

// ============ 模块级状态 ============

/** 活跃的竞技会话调度器映射 (projectId -> scheduler) */
const activeSchedulers = new Map<string, QueueScheduler>();

/** 活跃的竞技会话ID映射 (projectId -> sessionId) */
const activeSessionIds = new Map<string, string>();

// ============ WebSocket 进度推送 ============

/**
 * 广播竞技进度（复用wsManager）
 * 构造一个兼容 TaskInfo 的对象进行推送
 */
export function broadcastArenaProgress(taskId: string, progress: string): void {
  wsManager.broadcast(taskId, {
    id: taskId,
    status: 'processing',
    progress,
    startTime: Date.now(),
    result: null,
    error: null,
  });
}

/** 广播竞技完成 */
function broadcastArenaDone(taskId: string, result: string): void {
  wsManager.broadcast(taskId, {
    id: taskId,
    status: 'done',
    progress: result,
    startTime: Date.now(),
    result: { created: Date.now(), data: [{ url: '', revised_prompt: result }] },
    error: null,
  });
}

/** 广播竞技错误 */
function broadcastArenaError(taskId: string, error: string): void {
  wsManager.broadcast(taskId, {
    id: taskId,
    status: 'error',
    progress: '',
    startTime: Date.now(),
    result: null,
    error,
  });
}

// ============ 阶段1：创意方案竞争 ============

/**
 * 构建创意方案的 system prompt（从 generateCreativePlan 提取的核心逻辑）
 * @param writerPrompt 创作Agent的systemPrompt（组长=原始，组员=变异后）
 * @param config 项目配置
 */
export function buildCreativePlanSystemPrompt(writerPrompt: string, config: ScreenplayConfig): string {
  const total = config.totalEpisodes;
  const rise = Math.round(total * 0.15);
  const climb = Math.round(total * 0.30);
  const storm = Math.round(total * 0.35);
  const final_ = total - rise - climb - storm;
  const paywallCount = Math.round(total * 0.12);

  return `${writerPrompt}

你现在需要根据用户提供的创作配置，生成一份完整的创作方案。

## 节奏曲线要求
- 起势段（前15%，约${rise}集）：节奏偏快，密集建立信息，每2-3集一个小高潮
- 攀升段（15%-45%，约${climb}集）：节奏稳定上升，每5-7集一个中高潮，付费卡点密度最高
- 风暴段（45%-80%，约${storm}集）：节奏最快，高潮密集，每3-5集一个大高潮
- 决战段（最后20%，约${final_}集）：先紧后收，终极对决是全剧最高潮

## 付费卡点要求
- 总卡点数量：${paywallCount}个左右（占比10-15%）
- 首个卡点在第8-12集
- 卡点间隔至少5集
- 卡点类型：身份揭露/生死一线/情感爆发/反派得逞/真相大白

## 爽点矩阵
5大爽点类型：身份碾压、打脸复仇、逆袭翻盘、情感爆发、悬念揭秘
根据题材合理分配各类型占比。
${config.useTimeline ? `
## 跨时代时间线架构要求
本剧采用跨时代宏大叙事结构，需要设计多个时代/纪元，角色通过因果链跨时代关联。
` : ''}
请输出严格的 JSON 格式。`;
}

/**
 * 构建创意方案的 user prompt（从 generateCreativePlan 提取的核心逻辑）
 */
export function buildCreativePlanUserPrompt(config: ScreenplayConfig): string {
  const paywallCount = Math.round(config.totalEpisodes * 0.12);

  return `创作配置：
- 题材组合：${config.genres.join(' + ')}
- 目标受众：${config.audience}
- 故事基调：${config.tone}
- 结局类型：${config.endingType}
- 总集数：${config.totalEpisodes}集
${config.customPrompt ? `- 用户额外要求：${config.customPrompt}` : ''}
${config.referenceNovel ? `\n## 参考小说\n${config.referenceNovel.slice(0, 30000)}\n` : ''}

请生成创作方案，JSON 格式如下：
{
  "titleOptions": [{"title": "剧名", "description": "一句话说明"}],
  "setting": {"era": "时代", "location": "地点", "socialEnv": "社会环境", "classRelation": "阶层关系"},
  "storyLine": "一句话故事线",
  "coreConflict": "核心冲突",
  "fourActs": {
    "act1": {"episodeRange": "第1-N集", "coreEvents": ["事件1"], "relationships": "人物关系建立"},
    "act2": {"episodeRange": "第N-M集", "conflicts": ["冲突1"], "turningPoints": ["转折1"]},
    "act3": {"episodeRange": "第M-K集", "climax": "高潮对决", "turningPoints": ["转折1"]},
    "act4": {"episodeRange": "第K-末集", "ending": "结局处理", "themeElevation": "主题升华"}
  },
  "rhythmWave": "全剧节奏波形描述",
  "paywallPlan": [{"episode": 10, "type": "身份揭露", "suspense": "悬念描述"}],
  "satisfactionMatrix": {"身份碾压": 30, "打脸复仇": 25, "逆袭翻盘": 20, "情感爆发": 15, "悬念揭秘": 10},
  "endingDesign": {"mainLine": "主线结局", "romanceLine": "感情线结局", "foreshadowRecovery": "伏笔回收"}
}

要求：
1. 提供3个剧名备选
2. 四幕结构（起承转合）的集数范围必须覆盖全部${config.totalEpisodes}集
3. 付费卡点约${paywallCount}个
4. 爽点矩阵百分比之和为100`;
}

/**
 * 单个创作Agent生成创意方案
 */
async function generateSingleCreativePlan(
  projectId: string,
  writer: WriterAgent,
  config: ScreenplayConfig,
): Promise<CreativePlan | null> {
  const systemPrompt = buildCreativePlanSystemPrompt(writer.systemPrompt, config);
  const userPrompt = buildCreativePlanUserPrompt(config);

  try {
    const result = await chatCompletionJSON<CreativePlan>(systemPrompt, userPrompt, { timeoutMs: 600_000 });
    return result.success && result.data ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * 组内互审：组长审查组员方案 + 组员环形互审
 * 返回每个方案的互审评分（用于组内排名）
 */
async function peerReviewInGroup(
  projectId: string,
  groupCandidates: CandidateEntry<CreativePlan>[],
  group: { leader: WriterAgent; members: WriterAgent[] },
  scheduler: QueueScheduler,
): Promise<void> {
  const leaderCandidate = groupCandidates.find(c => c.writerId === group.leader.id);
  const memberCandidates = groupCandidates.filter(c => c.writerId !== group.leader.id);

  // 收集所有互审任务
  const reviewTasks: Array<() => Promise<{ candidateId: string; score: number } | null>> = [];

  // 1. 组长审查每个组员方案
  for (const mc of memberCandidates) {
    reviewTasks.push(() => executePeerReview(
      projectId, group.leader, mc, '组长审查',
    ));
  }

  // 2. 组员环形互审（组员i审查组员(i+1)%n）
  for (let i = 0; i < memberCandidates.length; i++) {
    const reviewerIdx = i;
    const targetIdx = (i + 1) % memberCandidates.length;
    if (memberCandidates.length > 1) {
      const reviewer = group.members[reviewerIdx];
      const target = memberCandidates[targetIdx];
      if (reviewer && target) {
        reviewTasks.push(() => executePeerReview(
          projectId, reviewer, target, '组员互审',
        ));
      }
    }
  }

  // 并发执行所有互审
  const results = await scheduler.enqueueBatch(reviewTasks);
  const validResults = results.filter((r): r is { candidateId: string; score: number } => r !== null);

  // 汇总互审评分到候选上（取平均分）
  const scoreMap = new Map<string, number[]>();
  for (const r of validResults) {
    if (!scoreMap.has(r.candidateId)) scoreMap.set(r.candidateId, []);
    scoreMap.get(r.candidateId)!.push(r.score);
  }

  // 组员方案：互审评分取平均
  for (const mc of memberCandidates) {
    const scores = scoreMap.get(mc.id);
    if (scores && scores.length > 0) {
      mc.score = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  // 组长方案：不被组员审查，给一个基础分（互审阶段不影响组长排名，最终靠跨组评审）
  if (leaderCandidate) {
    leaderCandidate.score = 7.0; // 组长基础分
  }
}

/**
 * 执行单次互审（LLM调用）
 */
async function executePeerReview(
  projectId: string,
  reviewer: WriterAgent,
  target: CandidateEntry<CreativePlan>,
  reviewType: string,
): Promise<{ candidateId: string; score: number } | null> {
  const systemPrompt = `${reviewer.systemPrompt}

你现在作为${reviewType}者，需要审查以下创意方案。
请从以下维度评分（0-10分）：
1. 故事创意的新颖度和吸引力
2. 剧情结构的合理性
3. 商业潜力和受众匹配度
4. 与本组创作风格的契合度

输出JSON格式：{"score": 数字, "suggestion": "修改建议"}`;

  const userPrompt = `请审查以下创意方案：
${JSON.stringify(target.data, null, 2)}`;

  try {
    const result = await chatCompletionJSON<{ score: number; suggestion: string }>(
      systemPrompt, userPrompt, { timeoutMs: 120_000 },
    );
    if (!result.success || !result.data) return null;
    const score = Math.max(0, Math.min(10, result.data.score));
    return { candidateId: target.id, score };
  } catch {
    return null;
  }
}

/**
 * 互审后组员修改方案（1轮）
 */
async function reviseAfterPeerReview(
  projectId: string,
  candidate: CandidateEntry<CreativePlan>,
  writer: WriterAgent,
  config: ScreenplayConfig,
  scheduler: QueueScheduler,
): Promise<void> {
  const result = await scheduler.enqueue(async () => {
    const systemPrompt = `${writer.systemPrompt}

你之前生成了一份创意方案，现在根据互审反馈进行修改优化。
请保持原方案的核心创意，但在结构和细节上进行改进。
输出与原方案相同的JSON格式。`;

    const userPrompt = `你的原方案：
${JSON.stringify(candidate.data, null, 2)}

请优化后输出完整的JSON格式方案。`;

    try {
      const res = await chatCompletionJSON<CreativePlan>(systemPrompt, userPrompt, { timeoutMs: 600_000 });
      return res.success && res.data ? res.data : null;
    } catch {
      return null;
    }
  });

  if (result) {
    candidate.data = result;
  }
}

/** 阶段1：创意方案竞争 */
export async function runCreativePlanArena(
  projectId: string,
  writers: WriterAgent[],
  reviewers: ReviewerAgent[],
  scheduler: QueueScheduler,
  taskId: string,
  sessionId: string,
): Promise<StageCandidates<CreativePlan>> {
  // 获取项目配置
  const project = getScreenplay(projectId);
  if (!project) {
    return { stage: 'creative_plan', candidates: [], totalGenerated: 0, totalSurvived: 0 };
  }
  const { config } = project;

  // 按组分组writers
  const writersByGroup = new Map<string, WriterAgent[]>();
  for (const w of writers) {
    if (!writersByGroup.has(w.groupId)) writersByGroup.set(w.groupId, []);
    writersByGroup.get(w.groupId)!.push(w);
  }

  // 构建 systemAgentId -> systemAgentName 映射
  const sysAgentNameMap = new Map<string, string>();
  for (const sa of SYSTEM_AGENTS) {
    sysAgentNameMap.set(sa.id, sa.name);
  }

  /** 获取组的系统Agent名称 */
  const getGroupSysName = (groupId: string): string => {
    const gw = writersByGroup.get(groupId);
    const leader = gw?.find(w => w.isLeader);
    return leader ? (sysAgentNameMap.get(leader.systemAgentId) || '') : '';
  };

  // ===== 第1步：50个Agent并发生成创意方案 =====
  const allCandidates: CandidateEntry<CreativePlan>[] = [];
  let completedCount = 0;
  const totalWriters = writers.length;

  const generationTasks = writers.map(writer => () =>
    generateSingleCreativePlan(projectId, writer, config).then(plan => {
      completedCount++;
      const sysAgentName = getGroupSysName(writer.groupId);
      broadcastArenaProgress(taskId,
        `创意方案: ${sysAgentName}组 ${completedCount}/${totalWriters} 完成 (总进度 ${completedCount}/${totalWriters})`,
      );
      return { writer, plan };
    }),
  );

  const results = await scheduler.enqueueBatch(generationTasks);

  // 构建CandidateEntry
  let candidateIdx = 0;
  for (const { writer, plan } of results) {
    if (!plan) continue;
    allCandidates.push({
      id: `plan-${sessionId}-${candidateIdx++}`,
      writerId: writer.id,
      groupId: writer.groupId,
      systemAgentId: writer.systemAgentId,
      systemAgentName: sysAgentNameMap.get(writer.systemAgentId) || '',
      data: plan,
      score: 0,
    });
  }

  const totalGenerated = allCandidates.length;

  // 持久化所有候选
  const candidateRows: ArenaCandidateRow[] = allCandidates.map(c => ({
    id: c.id,
    session_id: sessionId,
    stage: 'creative_plan',
    writer_id: c.writerId,
    group_id: c.groupId,
    system_agent_id: c.systemAgentId,
    system_agent_name: c.systemAgentName,
    parent_candidate_id: null,
    content: JSON.stringify(c.data),
    character_pool_ids: null,
    created_at: Date.now(),
  }));
  if (candidateRows.length > 0) {
    batchInsertArenaCandidates(candidateRows);
  }

  // ===== 第2步：组内互审 =====
  // 按组分组候选
  const candidatesByGroup = new Map<string, CandidateEntry<CreativePlan>[]>();
  for (const c of allCandidates) {
    if (!candidatesByGroup.has(c.groupId)) candidatesByGroup.set(c.groupId, []);
    candidatesByGroup.get(c.groupId)!.push(c);
  }

  for (const [groupId, groupCandidates] of candidatesByGroup) {
    const groupWriters = writersByGroup.get(groupId);
    if (!groupWriters || groupCandidates.length === 0) continue;

    const leader = groupWriters.find(w => w.isLeader)!;
    const members = groupWriters.filter(w => !w.isLeader);
    const sysAgentName = getGroupSysName(groupId);

    // 执行组内互审
    await peerReviewInGroup(projectId, groupCandidates, { leader, members }, scheduler);

    // 互审后组员修改1轮（组长方案不修改）
    const memberCandidates = groupCandidates.filter(c => c.writerId !== leader.id);
    const reviseTasks = memberCandidates.map(mc => {
      const memberWriter = members.find(m => m.id === mc.writerId);
      if (!memberWriter) return Promise.resolve();
      return reviseAfterPeerReview(projectId, mc, memberWriter, config, scheduler);
    });
    await Promise.all(reviseTasks);

    broadcastArenaProgress(taskId, `组内互审: ${sysAgentName}组 互审完成, 选出最佳方案`);
  }

  // 每组选出最佳1个方案 → 10个方案
  const bestPerGroup = selectBestPerGroup(allCandidates, 'groupId', 1);

  // ===== 第3步：跨组评审（剧情结构+商业潜力+创意新颖度，15人） =====
  const activeDirections = STAGE_REVIEW_MAP.creative_plan;
  const activeReviewers = reviewers.filter(r => activeDirections.includes(r.directionId));

  let reviewDoneCount = 0;
  const totalReviews = bestPerGroup.length * activeReviewers.length;

  for (const candidate of bestPerGroup) {
    const score = await reviewCandidate(
      projectId,
      candidate as CandidateEntry<unknown>,
      activeReviewers,
      'creative_plan',
    );
    candidate.score = score;
    reviewDoneCount += activeReviewers.length;

    // 按方向推送进度
    for (const dirId of activeDirections) {
      const dirName = REVIEW_DIRECTIONS.find(d => d.id === dirId)?.name || dirId;
      broadcastArenaProgress(taskId,
        `跨组评审: ${dirName} 完成 (${reviewDoneCount}/${totalReviews})`,
      );
    }
  }

  // ===== 第4步：Top 10排名 =====
  // 按分数降序排列并标注排名
  bestPerGroup.sort((a, b) => b.score - a.score);
  for (let i = 0; i < bestPerGroup.length; i++) {
    bestPerGroup[i].rank = i + 1;
    bestPerGroup[i].selected = i === 0; // 默认选中Top 1
  }

  // 持久化评分结果
  const scoreRows: ArenaFunnelScoreRow[] = bestPerGroup.map(c => ({
    id: `score-plan-${c.id}`,
    session_id: sessionId,
    stage: 'creative_plan',
    candidate_id: c.id,
    direction_scores: JSON.stringify(c.directionScores || []),
    weighted_total: Number.isFinite(c.score) ? c.score : 0,
    rank: c.rank ?? null,
    selected: c.selected ? 1 : 0,
    created_at: Date.now(),
  }));
  if (scoreRows.length > 0) {
    batchInsertArenaFunnelScores(scoreRows);
  }

  // 持久化评审记录
  const reviewRows: ArenaReviewRow[] = [];
  for (const candidate of bestPerGroup) {
    if (candidate.directionScores) {
      for (const ds of candidate.directionScores) {
        for (let i = 0; i < ds.rawScores.length; i++) {
          reviewRows.push({
            id: `review-plan-${candidate.id}-${ds.directionId}-${i}`,
            session_id: sessionId,
            candidate_id: candidate.id,
            reviewer_id: `reviewer-${ds.directionId}-${i}`,
            direction_id: ds.directionId,
            stage: 'creative_plan',
            score: ds.rawScores[i],
            comments: ds.comments?.[i] || '',
            created_at: Date.now(),
          });
        }
      }
    }
  }
  if (reviewRows.length > 0) {
    batchInsertArenaReviews(reviewRows);
  }

  // 推送最终结果
  const topCandidate = bestPerGroup[0];
  if (topCandidate) {
    broadcastArenaProgress(taskId,
      `Top 10方案已选出, 最高分${topCandidate.score.toFixed(1)}, 来自${topCandidate.systemAgentName}组`,
    );
  }

  return {
    stage: 'creative_plan',
    candidates: bestPerGroup,
    totalGenerated,
    totalSurvived: bestPerGroup.length,
  };
}

// ============ 阶段2：角色开发竞争 ============

/**
 * 构建含群演素材的角色设计Prompt
 * 注入writer的systemPrompt（组长=原始Prompt，组员=变异后Prompt）
 * 包含群演角色素材列表，要求优先使用群演角色并保留原始ID
 */
export function buildCharacterDesignPromptWithPool(
  plan: CreativePlan,
  pool: CharacterAgentRow[],
  writer: WriterAgent,
): string {
  const poolSummary = pool.slice(0, 100).map(a =>
    `[${a.id}] ${a.name}（${a.role}）| 分类：${a.category} | 性格：${(a.personality || '').slice(0, 80)} | 描述：${(a.description || '').slice(0, 80)}`,
  ).join('\n');

  return `${writer.systemPrompt}

你现在需要为以下剧本设计完整的角色体系。

## 创作方案摘要
- 故事线：${plan.storyLine}
- 核心冲突：${plan.coreConflict}
- 时空背景：${plan.setting.era}，${plan.setting.location}

【重要】以下是群演仓库中匹配到的候选角色素材，请优先从中选择和改编：
${poolSummary}

## 选角原则
1. 优先使用群演仓库中的角色，保留其核心性格和背景
2. 可以根据剧本需要调整角色的身份和动机
3. 如果群演角色不够用，可以新创角色补充
4. 必须标注每个角色是"群演改编"还是"原创新建"
5. 保留群演角色的原始ID（characterAgentId字段）

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

请输出严格JSON格式的角色体系设计。`;
}

/**
 * 构建纯LLM生成角色的Prompt（无群演素材）
 * 注入writer的systemPrompt，包含四层反派体系要求
 * 复用 generateCharacters 中的核心prompt逻辑
 */
export function buildCharacterDesignPromptDefault(
  plan: CreativePlan,
  writer: WriterAgent,
): string {
  return `${writer.systemPrompt}

你现在需要为以下剧本设计完整的角色体系。

## 创作方案摘要
- 故事线：${plan.storyLine}
- 核心冲突：${plan.coreConflict}
- 时空背景：${plan.setting.era}，${plan.setting.location}

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

请输出严格JSON格式的角色体系设计。`;
}

/**
 * 构建角色设计的用户Prompt（群演/纯生成共用）
 */
function buildCharacterDesignUserPrompt(
  plan: CreativePlan,
  pool: CharacterAgentRow[],
): string {
  const poolNote = pool.length > 0
    ? `\n候选群演角色数量：${pool.length}个（已在系统Prompt中列出）\n请优先从群演角色中选择，并在characterAgentId字段中保留其原始ID。`
    : '\n无群演角色可用，请完全原创设计。';

  return `请根据以下创作方案设计角色体系：

故事线：${plan.storyLine}
核心冲突：${plan.coreConflict}
四幕结构（起承转合）：
  第一幕·起：${getActsFromPlan(plan).act1.coreEvents.join('、')}
  第二幕·承：${getActsFromPlan(plan).act2.conflicts.join('、')}
  第三幕·转：${getActsFromPlan(plan).act3.climax}
  第四幕·合：${getActsFromPlan(plan).act4.ending}
${poolNote}

请生成角色设计，JSON格式：
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
      "villainLayer": 0,
      "characterAgentId": "群演角色原始ID或null"
    }
  ],
  "relationships": [{"from": "角色A", "to": "角色B", "relation": "关系描述"}],
  "romanceLine": [{"episode": 1, "event": "感情线节点"}],
  "villainSystem": {"layer1": [], "layer2": [], "layer3": [], "layer4": []}
}

要求：
1. 主要角色6-10个
2. villainLayer: 0=非反派, 1-4=对应反派层级
3. villainSystem中引用characters数组中的角色
4. romanceLine标注具体集数
5. 关系图覆盖所有主要角色间的关系`;
}

/**
 * 单Agent角色设计生成
 * 支持群演/纯生成两种模式：有群演素材池时用 buildCharacterDesignPromptWithPool，否则用 buildCharacterDesignPromptDefault
 */
export async function generateCharacterDesign(
  projectId: string,
  plan: CreativePlan,
  characterPool: CharacterAgentRow[],
  writer: WriterAgent,
): Promise<{ data: CharacterDesign; characterPoolIds: string[] } | null> {
  const systemPrompt = characterPool.length > 0
    ? buildCharacterDesignPromptWithPool(plan, characterPool, writer)
    : buildCharacterDesignPromptDefault(plan, writer);

  const userPrompt = buildCharacterDesignUserPrompt(plan, characterPool);

  try {
    const result = await chatCompletionJSON<CharacterDesign>(
      systemPrompt, userPrompt, { timeoutMs: 600_000 },
    );
    if (!result.success || !result.data) return null;

    // 提取使用的群演角色ID
    const characterPoolIds: string[] = [];
    if (characterPool.length > 0 && result.data.characters) {
      const poolIdSet = new Set(characterPool.map(a => a.id));
      for (const char of result.data.characters) {
        const agentId = (char as unknown as Record<string, unknown>).characterAgentId as string | undefined;
        if (agentId && poolIdSet.has(agentId)) {
          characterPoolIds.push(agentId);
        }
      }
    }

    return { data: result.data, characterPoolIds };
  } catch {
    return null;
  }
}

/**
 * 从群演仓库智能匹配候选角色（复用 generateCharactersFromPool 的匹配逻辑）
 */
async function matchCharacterPool(
  projectId: string,
  allAgents: CharacterAgentRow[],
  plan: CreativePlan,
  config: ScreenplayConfig,
): Promise<CharacterAgentRow[]> {
  const candidateSummary = allAgents.slice(0, 200).map(a =>
    `[${a.id}] ${a.name}（${a.role}）| 分类：${a.category} | 性格：${(a.personality || '').slice(0, 80)} | 描述：${(a.description || '').slice(0, 80)}`,
  ).join('\n');

  const matchSystem = `你是一位专业的选角导演。请从候选角色库中，为以下剧本选择最合适的角色。

选角原则：
1. 角色的性格、背景要与剧本世界观和题材匹配
2. 都市题材优先选现代背景角色，古装题材优先选古代背景角色
3. 需要有对立关系的角色（正派vs反派）
4. 需要有感情线的角色组合
5. 选择10-50个角色，优先选择描述丰富、性格鲜明的角色

输出严格JSON格式：
{ "selectedIds": ["id1", "id2", ...], "reason": "选角理由简述" }`;

  const matchUser = `剧本信息：
- 题材：${config.genres.join(' + ')}
- 受众：${config.audience}
- 基调：${config.tone}
- 故事线：${plan.storyLine}
- 核心冲突：${plan.coreConflict}
- 时空背景：${plan.setting.era}，${plan.setting.location}

候选角色库（共${allAgents.length}个）：
${candidateSummary}`;

  try {
    const matchResult = await chatCompletionJSON<{ selectedIds: string[]; reason: string }>(
      matchSystem, matchUser, { timeoutMs: 120_000 },
    );

    if (matchResult.success && matchResult.data && matchResult.data.selectedIds && matchResult.data.selectedIds.length >= 5) {
      const idSet = new Set(matchResult.data.selectedIds.slice(0, 100));
      return allAgents.filter(a => idSet.has(a.id));
    }
  } catch {
    // LLM匹配失败，降级处理
  }

  // 降级：按 category 匹配
  const genreKeywords = config.genres.join(' ');
  let selected = allAgents.filter(a =>
    (a.category && genreKeywords.includes(a.category)) ||
    (a.source_novel && genreKeywords.includes(a.source_novel)),
  ).slice(0, 50);
  if (selected.length < 5) selected = allAgents.slice(0, Math.min(30, allAgents.length));
  return selected;
}

/**
 * 为每个方案分配3个创作Agent：组长（必选）+ 2个组内变体
 * 如果组内变体不够，从其他组借用
 */
function assignWritersForPlan(
  candidate: CandidateEntry<unknown>,
  allWriters: WriterAgent[],
  agentsPerPlan: number,
): WriterAgent[] {
  // 找到该方案所属的系统Agent组长
  const leader = allWriters.find(
    w => w.systemAgentId === candidate.systemAgentId && w.isLeader,
  );
  if (!leader) return [];

  // 从同组中选变体Agent（排除组长）
  const sameGroupMembers = allWriters.filter(
    w => w.groupId === leader.groupId && !w.isLeader,
  );

  const assigned: WriterAgent[] = [leader];
  const needed = agentsPerPlan - 1; // 还需要的变体数

  // 优先从同组选
  for (let i = 0; i < Math.min(needed, sameGroupMembers.length); i++) {
    assigned.push(sameGroupMembers[i]);
  }

  // 如果同组变体不够，从其他组借用
  if (assigned.length < agentsPerPlan) {
    const otherMembers = allWriters.filter(
      w => w.groupId !== leader.groupId && !w.isLeader,
    );
    for (const m of otherMembers) {
      if (assigned.length >= agentsPerPlan) break;
      assigned.push(m);
    }
  }

  return assigned;
}

/** 阶段2：角色开发竞争（群演仓库集成，10×3→10） */
export async function runCharacterArena(
  projectId: string,
  topPlans: StageCandidates<unknown>,
  writers: WriterAgent[],
  reviewers: ReviewerAgent[],
  scheduler: QueueScheduler,
  taskId: string,
  sessionId: string,
): Promise<StageCandidates<unknown>> {
  const project = getScreenplay(projectId);
  if (!project) {
    return { stage: 'character', candidates: [], totalGenerated: 0, totalSurvived: 0 };
  }
  const { config } = project;

  // 构建 systemAgentId -> systemAgentName 映射
  const sysAgentNameMap = new Map<string, string>();
  for (const sa of SYSTEM_AGENTS) {
    sysAgentNameMap.set(sa.id, sa.name);
  }

  // ===== 第1步：从群演仓库匹配角色素材 =====
  const allCharAgents = listCharacterAgents();
  let characterPool: CharacterAgentRow[] = [];

  if (allCharAgents.length > 0) {
    // 用第一个方案的数据做匹配（所有方案共享同一个角色素材池）
    const firstPlan = topPlans.candidates[0]?.data as CreativePlan | undefined;
    if (firstPlan) {
      characterPool = await matchCharacterPool(projectId, allCharAgents, firstPlan, config);
    }
    broadcastArenaProgress(taskId, `群演匹配: 选中${characterPool.length}个候选角色`);
  } else {
    broadcastArenaProgress(taskId, '群演仓库为空, 回退到纯LLM生成角色');
  }

  // ===== 第2步：为每个方案分配3个Agent并发设计角色体系 =====
  const agentsPerPlan = 3;
  const allCandidates: CandidateEntry<unknown>[] = [];
  let completedCount = 0;
  const totalTasks = topPlans.candidates.length * agentsPerPlan;

  for (const planCandidate of topPlans.candidates) {
    const plan = planCandidate.data as CreativePlan;
    const assignedWriters = assignWritersForPlan(planCandidate, writers, agentsPerPlan);
    const sysAgentName = sysAgentNameMap.get(planCandidate.systemAgentId) || '';

    // 3个Agent并发设计角色体系
    const designTasks = assignedWriters.map(writer => () =>
      generateCharacterDesign(projectId, plan, characterPool, writer).then(result => {
        completedCount++;
        broadcastArenaProgress(taskId,
          `角色设计: ${sysAgentName}组 Agent${completedCount % agentsPerPlan || agentsPerPlan}/${agentsPerPlan} 完成`,
        );
        return { writer, result };
      }),
    );

    const results = await scheduler.enqueueBatch(designTasks);

    for (const { writer, result } of results) {
      if (!result) continue;
      allCandidates.push({
        id: `char-${sessionId}-${allCandidates.length}`,
        writerId: writer.id,
        groupId: planCandidate.groupId,
        systemAgentId: planCandidate.systemAgentId,
        systemAgentName: sysAgentName,
        parentCandidateId: planCandidate.id,
        data: result.data,
        characterPoolIds: result.characterPoolIds.length > 0 ? result.characterPoolIds : undefined,
        score: 0,
      });
    }
  }

  const totalGenerated = allCandidates.length;

  // 持久化所有候选
  const candidateRows: ArenaCandidateRow[] = allCandidates.map(c => ({
    id: c.id,
    session_id: sessionId,
    stage: 'character' as const,
    writer_id: c.writerId,
    group_id: c.groupId,
    system_agent_id: c.systemAgentId,
    system_agent_name: c.systemAgentName,
    parent_candidate_id: c.parentCandidateId || null,
    content: JSON.stringify(c.data),
    character_pool_ids: c.characterPoolIds ? JSON.stringify(c.characterPoolIds) : null,
    created_at: Date.now(),
  }));
  if (candidateRows.length > 0) {
    batchInsertArenaCandidates(candidateRows);
  }

  // ===== 第3步：评审（人物塑造+情感共鸣，10人） =====
  const activeDirections = STAGE_REVIEW_MAP.character;
  const activeReviewers = reviewers.filter(r => activeDirections.includes(r.directionId));

  let reviewDoneCount = 0;
  const totalReviews = allCandidates.length;

  for (const candidate of allCandidates) {
    const score = await reviewCandidate(
      projectId, candidate, activeReviewers, 'character',
    );
    candidate.score = score;
    reviewDoneCount++;
    broadcastArenaProgress(taskId, `角色评审: ${reviewDoneCount}/${totalReviews} 完成`);
  }

  // ===== 第4步：每方案保留最佳角色设计（按parentCandidateId分组） =====
  const bestPerPlan = selectBestPerGroup(allCandidates, 'parentCandidateId' as keyof CandidateEntry<unknown>, 1);

  // 持久化评分结果
  const scoreRows: ArenaFunnelScoreRow[] = bestPerPlan.map(c => ({
    id: `score-char-${c.id}`,
    session_id: sessionId,
    stage: 'character' as const,
    candidate_id: c.id,
    direction_scores: JSON.stringify(c.directionScores || []),
    weighted_total: Number.isFinite(c.score) ? c.score : 0,
    rank: c.rank ?? null,
    selected: c.selected ? 1 : 0,
    created_at: Date.now(),
  }));
  if (scoreRows.length > 0) {
    batchInsertArenaFunnelScores(scoreRows);
  }

  // 持久化评审记录
  const reviewRows: ArenaReviewRow[] = [];
  for (const candidate of bestPerPlan) {
    if (candidate.directionScores) {
      for (const ds of candidate.directionScores) {
        for (let i = 0; i < ds.rawScores.length; i++) {
          reviewRows.push({
            id: `review-char-${candidate.id}-${ds.directionId}-${i}`,
            session_id: sessionId,
            candidate_id: candidate.id,
            reviewer_id: `reviewer-${ds.directionId}-${i}`,
            direction_id: ds.directionId,
            stage: 'character',
            score: ds.rawScores[i],
            comments: ds.comments?.[i] || '',
            created_at: Date.now(),
          });
        }
      }
    }
  }
  if (reviewRows.length > 0) {
    batchInsertArenaReviews(reviewRows);
  }

  // 推送最终结果
  const topCandidate = bestPerPlan[0];
  if (topCandidate) {
    broadcastArenaProgress(taskId,
      `角色开发完成, 最高分${topCandidate.score.toFixed(1)}, 来自${topCandidate.systemAgentName}组`,
    );
  }

  return {
    stage: 'character',
    candidates: bestPerPlan,
    totalGenerated,
    totalSurvived: bestPerPlan.length,
  };
}

// ============ 阶段3辅助函数 ============

/**
 * 分配阶段比例（复用 screenplay-creator.ts 中的 distributePhases 逻辑，因其未导出）
 */
function distributePhases(total: number): { rise: number; climb: number; storm: number; final: number } {
  const rise = Math.round(total * 0.15);
  const climb = Math.round(total * 0.30);
  const storm = Math.round(total * 0.35);
  const final_ = total - rise - climb - storm;
  return { rise, climb, storm, final: final_ };
}

/**
 * 构建分集目录的 system prompt
 * 提取自 generateDirectory 的核心逻辑，注入 writer 的风格指导
 */
export function buildDirectorySystemPrompt(
  writerPrompt: string,
  config: ScreenplayConfig,
  creativePlan: CreativePlan | null,
): string {
  const phases = distributePhases(config.totalEpisodes);
  const paywallCount = Math.round(config.totalEpisodes * 0.12);
  const keyEpisodeCount = Math.round(config.totalEpisodes * 0.30);

  let timelineSection = '';
  if (creativePlan?.timelineArcs) {
    const arcs = creativePlan.timelineArcs;
    timelineSection = `
## 跨时代时间线约束
本剧采用跨时代叙事结构，分集目录必须严格遵循时间线架构。

### 时代划分
${arcs.eras.map((e: any) => `- ${e.name}（${e.id}）：${e.episodeRange}，背景：${e.setting.era} · ${e.setting.location}`).join('\n')}

### 伏笔/收线节点（必须在对应集数体现）
${arcs.foreshadowGraph.map((f: any) => `- 第${f.episode}集（${f.era}）[${f.type === 'plant' ? '埋伏笔' : '收线'}]：${f.description}`).join('\n')}

### 因果链节点（必须在对应集数体现）
${arcs.causalChains.map((c: any) => `- ${c.name}：${c.nodes.map((n: any) => `第${n.episode}集(${n.era})${n.event}`).join(' → ')}`).join('\n')}

### 时代切换要求
- 时代切换集必须标记为🔥（关键剧情）
- 切换时使用悬念钩或反转钩制造跨时代悬念
- 每个时代的首集要快速建立新时空的视觉和情感基调
`;
  }

  return `${writerPrompt}

你现在需要规划分集目录。

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
${timelineSection}
请输出严格的 JSON 数组。`;
}

/**
 * 构建分集目录的 user prompt
 * 提取自 generateDirectory 的核心逻辑
 */
export function buildDirectoryUserPrompt(
  config: ScreenplayConfig,
  creativePlan: CreativePlan,
  characterDesign: CharacterDesign,
): string {
  const charSummary = characterDesign.characters.map(c =>
    `${c.name}（${c.publicIdentity}${c.villainLayer ? `，第${c.villainLayer}层反派` : ''}）`,
  ).join('、');

  const acts = getActsFromPlan(creativePlan);
  const hasTimeline = !!creativePlan.timelineArcs;

  return `创作方案：
- 故事线：${creativePlan.storyLine}
- 核心冲突：${creativePlan.coreConflict}
- 四幕结构（起承转合）：
  第一幕·起(${acts.act1.episodeRange})：${acts.act1.coreEvents.join('、')}
  第二幕·承(${acts.act2.episodeRange})：${acts.act2.conflicts.join('、')}
  第三幕·转(${acts.act3.episodeRange})：${acts.act3.climax}
  第四幕·合(${acts.act4.episodeRange})：${acts.act4.ending}
- 角色：${charSummary}
- 付费卡点规划：${creativePlan.paywallPlan.map(p => `第${p.episode}集(${p.type})`).join('、')}
- 结局：${creativePlan.endingDesign.mainLine}

请为全部${config.totalEpisodes}集生成分集目录，JSON 数组格式：
[
  {
    "number": 1,
    "title": "集标题",
    "summary": "核心冲突或爽点一句话描述",
    "hookType": "悬念钩",
    "mark": "🔥",
    "act": "第一幕",
    "phase": "起势段"${hasTimeline ? `,
    "era": "era_1",
    "foreshadows": ["fs_1"]` : ''}
  }
]

要求：
1. 必须覆盖全部${config.totalEpisodes}集
2. 前10集至少3个🔥和2个💰
3. 🔥占比25-35%，💰占比10-15%
4. 每集都有hookType
5. phase必须是：起势段/攀升段/风暴段/决战段${hasTimeline ? `
6. 每集必须标注所属时代era（使用时代ID）
7. 涉及伏笔埋设或收线的集数，foreshadows数组中填入对应节点ID
8. 时代切换的集数必须标记为🔥` : ''}`;
}

/**
 * 单个Agent生成分集目录
 */
async function generateSingleDirectory(
  projectId: string,
  config: ScreenplayConfig,
  creativePlan: CreativePlan,
  characterDesign: CharacterDesign,
  writer: WriterAgent,
): Promise<EpisodeDirectoryItem[] | null> {
  const systemPrompt = buildDirectorySystemPrompt(writer.systemPrompt, config, creativePlan);
  const userPrompt = buildDirectoryUserPrompt(config, creativePlan, characterDesign);

  try {
    const result = await chatCompletionJSON<EpisodeDirectoryItem[]>(
      systemPrompt, userPrompt, { timeoutMs: 600_000 },
    );
    if (!result.success || !result.data) return null;

    // LLM 可能返回包裹对象 { "directory": [...] } 而非直接数组
    let directory: EpisodeDirectoryItem[] = result.data;
    if (!Array.isArray(directory)) {
      const obj = directory as unknown as Record<string, unknown>;
      const arr = Object.values(obj).find(v => Array.isArray(v)) as EpisodeDirectoryItem[] | undefined;
      if (!arr?.length) return null;
      directory = arr;
    }
    return directory;
  } catch {
    return null;
  }
}

/** 阶段3：分集目录竞争（10×2→5） */
export async function runDirectoryArena(
  projectId: string,
  topCombos: StageCandidates<unknown>,
  writers: WriterAgent[],
  reviewers: ReviewerAgent[],
  scheduler: QueueScheduler,
  taskId: string,
  sessionId: string,
): Promise<StageCandidates<unknown>> {
  const project = getScreenplay(projectId);
  if (!project) {
    return { stage: 'directory', candidates: [], totalGenerated: 0, totalSurvived: 0 };
  }
  const { config } = project;

  // 构建 systemAgentId -> systemAgentName 映射
  const sysAgentNameMap = new Map<string, string>();
  for (const sa of SYSTEM_AGENTS) {
    sysAgentNameMap.set(sa.id, sa.name);
  }

  // ===== 第1步：获取每个角色设计对应的创意方案 =====
  // topCombos 的每个 candidate.data 是 CharacterDesign，
  // parentCandidateId 指向阶段1的方案候选，从数据库获取方案内容
  const planCandidateRows = listArenaCandidatesByStage(sessionId, 'creative_plan');
  const planMap = new Map<string, CreativePlan>();
  for (const row of planCandidateRows) {
    try {
      planMap.set(row.id, JSON.parse(row.content) as CreativePlan);
    } catch { /* skip invalid */ }
  }

  // ===== 第2步：为每个"方案+角色"组合分配2个Agent并发生成目录 =====
  const agentsPerPlan = 2;
  const allCandidates: CandidateEntry<unknown>[] = [];
  let completedCount = 0;
  const totalTasks = topCombos.candidates.length * agentsPerPlan;

  for (const charCandidate of topCombos.candidates) {
    const characterDesign = charCandidate.data as CharacterDesign;
    const sysAgentName = sysAgentNameMap.get(charCandidate.systemAgentId) || '';

    // 通过 parentCandidateId 获取对应的创意方案
    const creativePlan = charCandidate.parentCandidateId
      ? planMap.get(charCandidate.parentCandidateId)
      : undefined;

    if (!creativePlan) {
      // 如果找不到方案，跳过该组合
      continue;
    }

    // 分配2个Agent：组长（必选）+ 1个组内变体
    const assignedWriters = assignWritersForPlan(charCandidate, writers, agentsPerPlan);

    // 2个Agent并发生成分集目录
    const dirTasks = assignedWriters.map(writer => () =>
      generateSingleDirectory(projectId, config, creativePlan, characterDesign, writer).then(result => {
        completedCount++;
        broadcastArenaProgress(taskId,
          `分集目录: ${sysAgentName}组 ${completedCount % agentsPerPlan || agentsPerPlan}/${agentsPerPlan} 完成 (总进度 ${completedCount}/${totalTasks})`,
        );
        return { writer, result };
      }),
    );

    const results = await scheduler.enqueueBatch(dirTasks);

    for (const { writer, result } of results) {
      if (!result) continue;
      allCandidates.push({
        id: `dir-${sessionId}-${allCandidates.length}`,
        writerId: writer.id,
        groupId: charCandidate.groupId,
        systemAgentId: charCandidate.systemAgentId,
        systemAgentName: sysAgentName,
        parentCandidateId: charCandidate.id,
        data: result,
        score: 0,
      });
    }
  }

  const totalGenerated = allCandidates.length;

  // 持久化所有候选
  const candidateRows: ArenaCandidateRow[] = allCandidates.map(c => ({
    id: c.id,
    session_id: sessionId,
    stage: 'directory' as const,
    writer_id: c.writerId,
    group_id: c.groupId,
    system_agent_id: c.systemAgentId,
    system_agent_name: c.systemAgentName,
    parent_candidate_id: c.parentCandidateId || null,
    content: JSON.stringify(c.data),
    character_pool_ids: null,
    created_at: Date.now(),
  }));
  if (candidateRows.length > 0) {
    batchInsertArenaCandidates(candidateRows);
  }

  // ===== 第3步：评审（节奏+商业+结构，15人） =====
  const activeDirections = STAGE_REVIEW_MAP.directory;
  const activeReviewers = reviewers.filter(r => activeDirections.includes(r.directionId));

  let reviewDoneCount = 0;
  const totalReviews = allCandidates.length;

  for (const candidate of allCandidates) {
    const score = await reviewCandidate(
      projectId, candidate, activeReviewers, 'directory',
    );
    candidate.score = score;
    reviewDoneCount++;
    broadcastArenaProgress(taskId, `目录评审: ${reviewDoneCount}/${totalReviews} 完成`);
  }

  // ===== 第4步：Top 5筛选（跨所有组合全局排名） =====
  // 按分数降序排列，取前5
  allCandidates.sort((a, b) => b.score - a.score);
  const top5 = allCandidates.slice(0, 5);
  top5.forEach((c, idx) => {
    c.rank = idx + 1;
    c.selected = idx === 0; // Top 1 默认选中
  });

  // 持久化评分结果
  const scoreRows: ArenaFunnelScoreRow[] = top5.map(c => ({
    id: `score-dir-${c.id}`,
    session_id: sessionId,
    stage: 'directory' as const,
    candidate_id: c.id,
    direction_scores: JSON.stringify(c.directionScores || []),
    weighted_total: Number.isFinite(c.score) ? c.score : 0,
    rank: c.rank ?? null,
    selected: c.selected ? 1 : 0,
    created_at: Date.now(),
  }));
  if (scoreRows.length > 0) {
    batchInsertArenaFunnelScores(scoreRows);
  }

  // 持久化评审记录
  const reviewRows: ArenaReviewRow[] = [];
  for (const candidate of top5) {
    if (candidate.directionScores) {
      for (const ds of candidate.directionScores) {
        for (let i = 0; i < ds.rawScores.length; i++) {
          reviewRows.push({
            id: `review-dir-${candidate.id}-${ds.directionId}-${i}`,
            session_id: sessionId,
            candidate_id: candidate.id,
            reviewer_id: `reviewer-${ds.directionId}-${i}`,
            direction_id: ds.directionId,
            stage: 'directory',
            score: ds.rawScores[i],
            comments: ds.comments?.[i] || '',
            created_at: Date.now(),
          });
        }
      }
    }
  }
  if (reviewRows.length > 0) {
    batchInsertArenaReviews(reviewRows);
  }

  // 推送最终结果
  const topCandidate = top5[0];
  if (topCandidate) {
    broadcastArenaProgress(taskId,
      `目录评审: ${totalReviews}/${totalReviews} 完成, Top 5已选出, 最高分${topCandidate.score.toFixed(1)}, 来自${topCandidate.systemAgentName}组`,
    );
  }

  return {
    stage: 'directory',
    candidates: top5,
    totalGenerated,
    totalSurvived: top5.length,
  };
}

// ============ 阶段4辅助函数 ============

/**
 * 构建单集剧本的 system prompt
 * 将组长的完整systemPrompt（含【对白风格】【情绪节奏】等）注入
 */
export function buildEpisodeSystemPrompt(
  writerPrompt: string,
  config: ScreenplayConfig,
  episodeNumber: number,
  dirItem: EpisodeDirectoryItem,
): string {
  const isDomestic = config.mode === 'domestic';
  const isFirstEpisode = episodeNumber === 1;

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
- 场景描写（description字段）：每个场景50-80字的镜头指示，用2-3个镜头段落
- 台词对话（dialogues数组）：每个场景4-6轮对话，每句台词15-30字，要有冲突感和潜台词
- 每集总字数600-900字（对应1-3分钟屏幕时间），台词占60-70%，场景描写占30-40%
- 至少使用2种景别
- 节奏要快，每个场景都要推进剧情或制造冲突
- 结尾必须有悬念钩子（类型：${dirItem.hookType}）
${isFirstEpisode ? '- 第1集前10秒必须抓住观众（直接进入冲突）' : ''}
${dirItem.mark === '💰' ? '- 付费卡点集：结尾必须制造最强悬念' : ''}`;

  return `${writerPrompt}

## 当前任务：撰写第${episodeNumber}集完整剧本

## 格式要求（${isDomestic ? '国内' : '海外'}模式）
${formatBlock}

${qualityBlock}

请输出严格的 JSON 格式。`;
}

/**
 * 构建单集剧本的 user prompt
 */
export function buildEpisodeUserPrompt(
  config: ScreenplayConfig,
  creativePlan: CreativePlan,
  characterDesign: CharacterDesign,
  dirItem: EpisodeDirectoryItem,
  episodeNumber: number,
  prevHook: string,
): string {
  // 角色简表
  const charBrief = characterDesign.characters.map(c =>
    `${c.name}：${c.publicIdentity}，性格${c.personality.join('/')}，口头禅"${c.catchphrase}"`,
  ).join('\n');

  return `第${episodeNumber}集信息：
- 标题：${dirItem.title}
- 梗概：${dirItem.summary}
- 钩子类型：${dirItem.hookType}
- 标记：${dirItem.mark || '常规'}
- 所属阶段：${dirItem.phase}
${prevHook ? `- 上集钩子：${prevHook}` : ''}

角色简表：
${charBrief}

故事线：${creativePlan.storyLine}
核心冲突：${creativePlan.coreConflict}

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
      "description": "△ 全景：场景描写...",
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
  "mark": "${dirItem.mark || ''}"
}`;
}

/**
 * 单集剧本生成（竞技模式）
 * 使用组长的systemPrompt + 格式要求构建prompt，调用LLM生成
 */
async function generateSingleEpisode(
  projectId: string,
  config: ScreenplayConfig,
  creativePlan: CreativePlan,
  characterDesign: CharacterDesign,
  dirItem: EpisodeDirectoryItem,
  writer: WriterAgent,
  prevHook: string,
): Promise<EpisodeScript | null> {
  const systemPrompt = buildEpisodeSystemPrompt(
    writer.systemPrompt, config, dirItem.number, dirItem,
  );
  const userPrompt = buildEpisodeUserPrompt(
    config, creativePlan, characterDesign, dirItem, dirItem.number, prevHook,
  );

  try {
    const result = await chatCompletionJSON<EpisodeScript>(systemPrompt, userPrompt);
    if (!result.success || !result.data) return null;

    // 确保 number 字段正确
    result.data.number = dirItem.number;
    result.data.keywords = result.data.keywords || [];
    result.data.phase = dirItem.phase;
    result.data.hookType = dirItem.hookType;
    result.data.mark = dirItem.mark;
    return result.data;
  } catch {
    return null;
  }
}

/**
 * 根据评审意见修改单集剧本（打回修改）
 * 组长根据自身风格特色和评审意见进行修改
 */
async function reviseEpisodeAfterReview(
  writer: WriterAgent,
  episode: EpisodeScript,
  reviewComments: string[],
  score: number,
): Promise<EpisodeScript | null> {
  const systemPrompt = `${writer.systemPrompt}

## 当前任务：根据评审意见修改第${episode.number}集剧本

## 改写原则
- 只修改评审中指出的问题，保留原剧本的优点和整体结构
- 台词改写要保持角色语气一致性
- 不要改变剧情走向和关键情节点
- 保持原有的钩子类型和节奏标记
- 保持你的创作风格特色

请输出完整的改写后剧本，严格 JSON 格式。`;

  const userPrompt = `原剧本：
${JSON.stringify(episode, null, 2)}

当前评分：${score.toFixed(1)}/10

评审意见：
${reviewComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

请根据以上评审意见改写优化这集剧本，保持JSON格式输出。`;

  try {
    const result = await chatCompletionJSON<EpisodeScript>(systemPrompt, userPrompt);
    if (!result.success || !result.data) return null;

    // 确保关键字段不变
    result.data.number = episode.number;
    result.data.phase = episode.phase;
    result.data.hookType = episode.hookType;
    result.data.mark = episode.mark;
    result.data.keywords = result.data.keywords || [];
    return result.data;
  } catch {
    return null;
  }
}

/**
 * 逐集评审+打回修改
 * 评审使用全部10个方向的评审Agent（50人）
 * 评分 < passScore 时打回修改，最多打回2次
 *
 * @returns 最终的评分和评审意见
 */
async function reviewAndReviseEpisode(
  projectId: string,
  episode: EpisodeScript,
  writer: WriterAgent,
  reviewers: ReviewerAgent[],
  passScore: number,
  candidateId: string,
  systemAgentName: string,
): Promise<{ finalEpisode: EpisodeScript; finalScore: number; directionScores: DirectionScore[] }> {
  const maxRevisions = 2;
  let currentEpisode = episode;
  let currentScore = 0;
  let currentDirScores: DirectionScore[] = [];

  for (let attempt = 0; attempt <= maxRevisions; attempt++) {
    // 构建临时候选用于评审
    const tempCandidate: CandidateEntry<EpisodeScript> = {
      id: `${candidateId}-ep${episode.number}-rev${attempt}`,
      writerId: writer.id,
      groupId: writer.groupId,
      systemAgentId: writer.systemAgentId,
      systemAgentName,
      data: currentEpisode,
      score: 0,
    };

    // 全10方向评审
    currentScore = await reviewCandidate(projectId, tempCandidate, reviewers, 'episode');
    currentDirScores = tempCandidate.directionScores || [];

    // 通过分数线或已达最大修改次数，结束
    if (currentScore >= passScore || attempt === maxRevisions) {
      break;
    }

    // 收集评审意见用于打回修改
    const comments: string[] = [];
    for (const ds of currentDirScores) {
      if (ds.comments) {
        comments.push(...ds.comments.filter(c => c.length > 0));
      }
    }

    // 打回修改
    const revised = await reviseEpisodeAfterReview(
      writer, currentEpisode, comments, currentScore,
    );

    if (revised) {
      currentEpisode = revised;
    } else {
      // 修改失败，保留当前版本
      break;
    }
  }

  return {
    finalEpisode: currentEpisode,
    finalScore: currentScore,
    directionScores: currentDirScores,
  };
}

/** 阶段4：分集剧本全量+逐集评审（5→3） */
export async function runEpisodeArena(
  projectId: string,
  topDirs: StageCandidates<unknown>,
  writers: WriterAgent[],
  reviewers: ReviewerAgent[],
  scheduler: QueueScheduler,
  taskId: string,
  sessionId: string,
): Promise<StageCandidates<unknown>> {
  const project = getScreenplay(projectId);
  if (!project) {
    return { stage: 'episode', candidates: [], totalGenerated: 0, totalSurvived: 0 };
  }
  const { config } = project;

  // 获取passScore：从arena_sessions的config中读取
  const sessionRow = getArenaSessionByProjectId(projectId);
  const passScore = sessionRow
    ? (JSON.parse(sessionRow.config) as ArenaConfig).passScore
    : 5.5; // 默认standard

  // 构建 systemAgentId -> systemAgentName 映射
  const sysAgentNameMap = new Map<string, string>();
  for (const sa of SYSTEM_AGENTS) {
    sysAgentNameMap.set(sa.id, sa.name);
  }

  // ===== 第1步：获取每个目录候选对应的方案和角色设计 =====
  // topDirs 的每个 candidate.data 是 EpisodeDirectoryItem[]
  // parentCandidateId 指向阶段2的角色设计候选
  const charCandidateRows = listArenaCandidatesByStage(sessionId, 'character');
  const charMap = new Map<string, CharacterDesign>();
  for (const row of charCandidateRows) {
    try { charMap.set(row.id, JSON.parse(row.content) as CharacterDesign); } catch { /* skip */ }
  }

  const planCandidateRows = listArenaCandidatesByStage(sessionId, 'creative_plan');
  const planMap = new Map<string, CreativePlan>();
  for (const row of planCandidateRows) {
    try { planMap.set(row.id, JSON.parse(row.content) as CreativePlan); } catch { /* skip */ }
  }

  // 全10方向评审Agent
  const activeDirections = STAGE_REVIEW_MAP.episode;
  const activeReviewers = reviewers.filter(r => activeDirections.includes(r.directionId));

  // ===== 第2步：Top 5各由组长全量生成分集剧本 + 逐集评审 =====
  interface EpisodeResult {
    candidateId: string;
    systemAgentId: string;
    systemAgentName: string;
    groupId: string;
    writerId: string;
    parentCandidateId: string;
    episodes: EpisodeScript[];
    episodeScores: Record<number, number>;
    episodeDirScores: Record<number, DirectionScore[]>;
    avgScore: number;
  }

  const episodeResults: EpisodeResult[] = [];

  for (const dirCandidate of topDirs.candidates) {
    const directory = dirCandidate.data as EpisodeDirectoryItem[];
    const sysAgentName = sysAgentNameMap.get(dirCandidate.systemAgentId) || '';

    // 找到该候选所属的组长
    const leader = writers.find(
      w => w.systemAgentId === dirCandidate.systemAgentId && w.isLeader,
    );
    if (!leader) continue;

    // 通过 parentCandidateId 链获取角色设计和方案
    const charDesign = dirCandidate.parentCandidateId
      ? charMap.get(dirCandidate.parentCandidateId)
      : undefined;

    // 角色候选的 parentCandidateId 指向方案
    const charRow = charCandidateRows.find(r => r.id === dirCandidate.parentCandidateId);
    const creativePlan = charRow?.parent_candidate_id
      ? planMap.get(charRow.parent_candidate_id)
      : undefined;

    if (!charDesign || !creativePlan) continue;

    const candidateId = `ep-${sessionId}-${episodeResults.length}`;
    const episodes: EpisodeScript[] = [];
    const episodeScores: Record<number, number> = {};
    const episodeDirScores: Record<number, DirectionScore[]> = {};
    let prevHook = '';

    // 逐集生成 + 逐集评审
    for (const dirItem of directory) {
      // 生成单集
      const episode = await scheduler.enqueue(() =>
        generateSingleEpisode(
          projectId, config, creativePlan, charDesign, dirItem, leader, prevHook,
        ),
      );

      if (!episode) {
        broadcastArenaProgress(taskId,
          `剧本生成: ${sysAgentName}组长 第${dirItem.number}集 失败，跳过`,
        );
        continue;
      }

      broadcastArenaProgress(taskId,
        `剧本生成: ${sysAgentName}组长 第${dirItem.number}集`,
      );

      // 逐集评审 + 打回修改
      const { finalEpisode, finalScore, directionScores } = await reviewAndReviseEpisode(
        projectId, episode, leader, activeReviewers, passScore,
        candidateId, sysAgentName,
      );

      const revisionCount = finalEpisode !== episode ? 1 : 0;
      if (finalScore < passScore && revisionCount > 0) {
        broadcastArenaProgress(taskId,
          `打回修改: ${sysAgentName}组长 第${dirItem.number}集 最终${finalScore.toFixed(1)}分`,
        );
      }

      broadcastArenaProgress(taskId,
        `逐集评审: ${sysAgentName}组 第${dirItem.number}集 ${finalScore.toFixed(1)}分`,
      );

      episodes.push(finalEpisode);
      episodeScores[dirItem.number] = finalScore;
      episodeDirScores[dirItem.number] = directionScores;
      prevHook = finalEpisode.endHook || '';
    }

    // 计算综合评分 = 所有集的平均评分
    const scoreValues = Object.values(episodeScores);
    const avgScore = scoreValues.length > 0
      ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
      : 0;

    episodeResults.push({
      candidateId,
      systemAgentId: dirCandidate.systemAgentId,
      systemAgentName: sysAgentName,
      groupId: dirCandidate.groupId,
      writerId: leader.id,
      parentCandidateId: dirCandidate.id,
      episodes,
      episodeScores,
      episodeDirScores,
      avgScore,
    });
  }

  const totalGenerated = episodeResults.length;

  // ===== 第3步：构建候选条目并持久化 =====
  const allCandidates: CandidateEntry<unknown>[] = episodeResults.map(r => ({
    id: r.candidateId,
    writerId: r.writerId,
    groupId: r.groupId,
    systemAgentId: r.systemAgentId,
    systemAgentName: r.systemAgentName,
    parentCandidateId: r.parentCandidateId,
    data: {
      episodes: r.episodes,
      episodeScores: r.episodeScores,
    },
    score: r.avgScore,
  }));

  // 持久化候选
  const candidateRows: ArenaCandidateRow[] = allCandidates.map(c => ({
    id: c.id,
    session_id: sessionId,
    stage: 'episode' as const,
    writer_id: c.writerId,
    group_id: c.groupId,
    system_agent_id: c.systemAgentId,
    system_agent_name: c.systemAgentName,
    parent_candidate_id: c.parentCandidateId || null,
    content: JSON.stringify(c.data),
    character_pool_ids: null,
    created_at: Date.now(),
  }));
  if (candidateRows.length > 0) {
    batchInsertArenaCandidates(candidateRows);
  }

  // ===== 第4步：Top 3筛选（按综合评分排名） =====
  allCandidates.sort((a, b) => b.score - a.score);
  const top3 = allCandidates.slice(0, 3);
  top3.forEach((c, idx) => {
    c.rank = idx + 1;
    c.selected = idx === 0;
  });

  // 持久化评分结果
  const scoreRows: ArenaFunnelScoreRow[] = top3.map(c => {
    // 汇总所有集的方向评分
    const epResult = episodeResults.find(r => r.candidateId === c.id);
    const allDirScores: DirectionScore[] = [];
    if (epResult) {
      for (const ds of Object.values(epResult.episodeDirScores)) {
        allDirScores.push(...ds);
      }
    }
    return {
      id: `score-ep-${c.id}`,
      session_id: sessionId,
      stage: 'episode' as const,
      candidate_id: c.id,
      direction_scores: JSON.stringify(allDirScores),
      weighted_total: Number.isFinite(c.score) ? c.score : 0,
      rank: c.rank ?? null,
      selected: c.selected ? 1 : 0,
      created_at: Date.now(),
    };
  });
  if (scoreRows.length > 0) {
    batchInsertArenaFunnelScores(scoreRows);
  }

  // 持久化评审记录（Top 3的所有集评审）
  const reviewRows: ArenaReviewRow[] = [];
  for (const c of top3) {
    const epResult = episodeResults.find(r => r.candidateId === c.id);
    if (!epResult) continue;
    for (const [epNum, dirScores] of Object.entries(epResult.episodeDirScores)) {
      for (const ds of dirScores) {
        for (let i = 0; i < ds.rawScores.length; i++) {
          reviewRows.push({
            id: `review-ep-${c.id}-e${epNum}-${ds.directionId}-${i}`,
            session_id: sessionId,
            candidate_id: c.id,
            reviewer_id: `reviewer-${ds.directionId}-${i}`,
            direction_id: ds.directionId,
            stage: 'episode',
            score: ds.rawScores[i],
            comments: ds.comments?.[i] || '',
            created_at: Date.now(),
          });
        }
      }
    }
  }
  if (reviewRows.length > 0) {
    batchInsertArenaReviews(reviewRows);
  }

  // 推送最终结果
  const topCandidate = top3[0];
  if (topCandidate) {
    broadcastArenaProgress(taskId,
      `竞技完成: Top 3剧本, 最高分${topCandidate.score.toFixed(1)}, 冠军来自${topCandidate.systemAgentName}组`,
    );
  }

  return {
    stage: 'episode',
    candidates: top3,
    totalGenerated,
    totalSurvived: top3.length,
  };
}

// ============ 主编排函数 ============

/**
 * 启动竞技创作（异步，不阻塞API响应）
 * 1. 创建竞技会话
 * 2. 组建10个系统Agent创作组 + 50个评审Agent
 * 3. 持久化Agent数据
 * 4. 串联4个阶段，每阶段完成后更新session状态
 */
export async function startArenaCreation(
  projectId: string,
  arenaConfig: ArenaConfig,
  taskId: string,
): Promise<void> {
  const sessionId = `arena-${projectId}-${Date.now()}`;
  const now = Date.now();

  // 1. 创建竞技会话
  createArenaSession({
    id: sessionId,
    project_id: projectId,
    config: JSON.stringify(arenaConfig),
    status: 'init',
    current_stage: null,
    task_id: taskId,
    created_at: now,
    completed_at: null,
  });

  activeSessionIds.set(projectId, sessionId);
  broadcastArenaProgress(taskId, '竞技初始化: 组建8个骨架Agent创作组(骨架×风格双层融合) + 50个评审Agent');

  // 2. 获取项目题材信息，用于Agent题材匹配
  const project = getScreenplay(projectId);
  const genres = project?.config?.genres || [];

  // 3. 组建创作组（根据题材匹配度分配组长和组员）和评审Agent
  const writerGroups = buildWriterGroups(arenaConfig.membersPerGroup, genres);
  const reviewers = generateReviewerAgents();

  // 3. 持久化Agent数据
  const writerRows: ArenaWriterRow[] = [];
  for (const group of writerGroups) {
    const allAgents = [group.leader, ...group.members];
    for (const agent of allAgents) {
      writerRows.push({
        id: agent.id,
        session_id: sessionId,
        group_id: agent.groupId,
        name: agent.name,
        is_leader: agent.isLeader ? 1 : 0,
        system_agent_id: agent.systemAgentId,
        system_agent_name: group.systemAgentName,
        base_style_id: agent.styleGene.baseStyleId,
        style_gene: JSON.stringify(agent.styleGene),
        system_prompt: agent.systemPrompt,
        created_at: now,
      });
    }
  }
  batchInsertArenaWriters(writerRows);

  const reviewerRows: ArenaReviewerRow[] = reviewers.map(r => ({
    id: r.id,
    session_id: sessionId,
    direction_id: r.directionId,
    direction_name: r.directionName,
    system_prompt: r.systemPrompt,
    weight: r.weight,
    created_at: now,
  }));
  batchInsertArenaReviewers(reviewerRows);

  // 4. 创建并发调度器
  const scheduler = new QueueScheduler(arenaConfig.concurrency);
  activeSchedulers.set(projectId, scheduler);

  // 收集所有writer用于阶段执行
  const allWriters = writerGroups.flatMap(g => [g.leader, ...g.members]);

  // 5. 串联4个阶段（异步执行，不阻塞）
  try {
    // 阶段1：创意方案
    updateArenaSession(sessionId, { status: 'stage_plan', current_stage: 'creative_plan' });
    broadcastArenaProgress(taskId, '阶段1开始: 创意方案竞争 (8骨架组×风格融合)');
    const planResult = await runCreativePlanArena(
      projectId, allWriters, reviewers, scheduler, taskId, sessionId,
    );

    // 阶段2：角色开发
    updateArenaSession(sessionId, { status: 'stage_char', current_stage: 'character' });
    broadcastArenaProgress(taskId, '阶段2开始: 角色开发竞争 (引入群演仓库)');
    const charResult = await runCharacterArena(
      projectId, planResult, allWriters, reviewers, scheduler, taskId, sessionId,
    );

    // 阶段3：分集目录
    updateArenaSession(sessionId, { status: 'stage_dir', current_stage: 'directory' });
    broadcastArenaProgress(taskId, '阶段3开始: 分集目录竞争');
    const dirResult = await runDirectoryArena(
      projectId, charResult, allWriters, reviewers, scheduler, taskId, sessionId,
    );

    // 阶段4：分集剧本
    updateArenaSession(sessionId, { status: 'stage_ep', current_stage: 'episode' });
    broadcastArenaProgress(taskId, '阶段4开始: 分集剧本全量生成+逐集评审');
    await runEpisodeArena(
      projectId, dirResult, allWriters, reviewers, scheduler, taskId, sessionId,
    );

    // 全部完成
    updateArenaSession(sessionId, { status: 'completed', completed_at: Date.now() });
    broadcastArenaDone(taskId, '竞技创作完成');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 如果是被停止的，不算错误
    if (errMsg === 'Scheduler stopped') {
      updateArenaSession(sessionId, { status: 'stopped' });
      broadcastArenaProgress(taskId, '竞技已停止');
    } else {
      updateArenaSession(sessionId, { status: 'stopped' });
      broadcastArenaError(taskId, `竞技出错: ${errMsg}`);
    }
  } finally {
    activeSchedulers.delete(projectId);
    activeSessionIds.delete(projectId);
  }
}

// ============ 停止竞技 ============

/**
 * 优雅停止竞技创作
 * 调用 QueueScheduler.stop()，当前执行中的LLM调用完成后停止
 */
export function stopArenaCreation(projectId: string): void {
  const scheduler = activeSchedulers.get(projectId);
  if (scheduler) {
    scheduler.stop();
  }
  // session状态更新由 startArenaCreation 的 catch 块处理
}

// ============ 用户选择候选 ============

/**
 * 用户选择某阶段的候选（幂等操作）
 * 重复选择同一候选不会产生副作用
 */
export function selectCandidate(
  projectId: string,
  stage: FunnelStage,
  candidateId: string,
): void {
  // 幂等：先取消同阶段所有选中，再选中目标
  updateArenaFunnelScoreSelected(candidateId, stage, true);
}

// ============ 查询函数 ============

/**
 * 获取竞技状态
 * 从数据库读取session和writer信息，组装ArenaStatus
 */
export function getArenaStatus(projectId: string): ArenaStatus | null {
  const session = getArenaSessionByProjectId(projectId);
  if (!session) return null;

  const config: ArenaConfig = JSON.parse(session.config);
  const writers = listArenaWritersBySession(session.id);

  // 组装创作组概览
  const groupMap = new Map<string, ArenaGroupInfo>();
  for (const w of writers) {
    if (!groupMap.has(w.group_id)) {
      groupMap.set(w.group_id, {
        groupId: w.group_id,
        systemAgentId: w.system_agent_id,
        systemAgentName: w.system_agent_name,
        leaderName: '',
        memberCount: 0,
      });
    }
    const info = groupMap.get(w.group_id)!;
    if (w.is_leader) {
      info.leaderName = w.name;
    } else {
      info.memberCount++;
    }
  }

  // 组装各阶段状态
  const stages: ArenaStatus['stages'] = {};
  const stageList: FunnelStage[] = ['creative_plan', 'character', 'directory', 'episode'];
  for (const stg of stageList) {
    const candidates = listArenaCandidatesByStage(session.id, stg);
    const scores = listArenaFunnelScoresByStage(session.id, stg);
    if (candidates.length > 0 || scores.length > 0) {
      const selectedScore = scores.find(s => s.selected === 1);
      stages[stg] = {
        status: getStageStatusFromSession(session.status, stg),
        totalCandidates: candidates.length,
        survivedCandidates: scores.length,
        selectedCandidateId: selectedScore?.candidate_id,
        progress: `${scores.length}/${candidates.length} 通过评审`,
      };
    }
  }

  return {
    sessionId: session.id,
    projectId: session.project_id,
    config,
    status: session.status,
    currentStage: session.current_stage as FunnelStage | null,
    groups: Array.from(groupMap.values()),
    stages,
    taskId: session.task_id,
  };
}

/** 根据session状态推断某阶段的状态 */
function getStageStatusFromSession(
  sessionStatus: string,
  stage: FunnelStage,
): StageStatus['status'] {
  const stageOrder: Record<string, number> = {
    creative_plan: 1,
    character: 2,
    directory: 3,
    episode: 4,
  };
  const sessionStageMap: Record<string, number> = {
    init: 0,
    stage_plan: 1,
    stage_char: 2,
    stage_dir: 3,
    stage_ep: 4,
    completed: 5,
    stopped: -1,
  };

  const currentOrder = sessionStageMap[sessionStatus] ?? 0;
  const stageIdx = stageOrder[stage];

  if (sessionStatus === 'completed' || currentOrder > stageIdx) return 'completed';
  if (currentOrder === stageIdx) return 'creating';
  return 'pending';
}

/**
 * 获取某阶段的候选列表（含评分信息）
 */
export function getArenaCandidates(
  projectId: string,
  stage: FunnelStage,
): Array<{
  id: string;
  groupId: string;
  systemAgentId: string;
  systemAgentName: string;
  content: unknown;
  score: number;
  rank: number | null;
  selected: boolean;
}> {
  const session = getArenaSessionByProjectId(projectId);
  if (!session) return [];

  const candidates = listArenaCandidatesByStage(session.id, stage);
  const scores = listArenaFunnelScoresByStage(session.id, stage);

  // 用scoreMap快速查找
  const scoreMap = new Map(scores.map(s => [s.candidate_id, s]));

  return candidates.map(c => {
    const scoreRow = scoreMap.get(c.id);
    return {
      id: c.id,
      groupId: c.group_id,
      systemAgentId: c.system_agent_id,
      systemAgentName: c.system_agent_name,
      content: JSON.parse(c.content),
      score: scoreRow?.weighted_total ?? 0,
      rank: scoreRow?.rank ?? null,
      selected: scoreRow?.selected === 1,
    };
  }).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
}
