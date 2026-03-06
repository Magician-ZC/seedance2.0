// 剧本角斗场核心业务逻辑
import crypto from 'node:crypto';
import { getDB, saveDB, getAgentById } from './db-service.js';
import { listScreenplays, getScreenplay, createScreenplay, updateScreenplay } from './screenplay-creator.js';
import { chatCompletionJSON } from './llm-service.js';
import type { ArenaScreenplayInfo, ArenaScoreResult, BattleResult, DimensionBattleResult, DimensionScores, EvolutionPlan, EvolutionElement, EvolutionRecord, LeaderboardEntry, ReviewRole, RoleScoreResult, ScreenplayArenaHistory, TournamentResult, TournamentRound, TournamentMatch } from './arena-types.js';
import { wsManager } from './ws-manager.js';

// ============================================================
// ELO 计算
// ============================================================

/** 标准 ELO 期望胜率 */
export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** 标准 ELO 积分更新，scoreA: 1=胜, 0.5=平, 0=负 */
export function updateELO(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  K: number = 32
): { newRatingA: number; newRatingB: number } {
  const expectedA = calculateExpectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;
  return {
    newRatingA: Math.round(ratingA + K * (scoreA - expectedA)),
    newRatingB: Math.round(ratingB + K * ((1 - scoreA) - expectedB)),
  };
}

// ============================================================
// ELO 初始化
// ============================================================

/** 确保剧本在 arena_elo 表中有记录，不存在则初始化为 1200 */
export function ensureELO(screenplayId: string): void {
  const d = getDB();
  const stmt = d.prepare('SELECT screenplay_id FROM arena_elo WHERE screenplay_id = ?');
  stmt.bind([screenplayId]);
  const exists = stmt.step();
  stmt.free();

  if (!exists) {
    d.run(
      'INSERT INTO arena_elo (screenplay_id, elo, wins, losses, draws, updated_at) VALUES (?, 1200, 0, 0, 0, ?)',
      [screenplayId, Date.now()]
    );
    saveDB();
  }
}

// ============================================================
// 已完成剧本查询
// ============================================================

/** 获取所有已完成剧本，关联 ELO、最新评分和进化代数 */
export function getArenaScreenplays(): ArenaScreenplayInfo[] {
  const allProjects = listScreenplays();
  const d = getDB();

  // 过滤已完成剧本：status === 'exported' 或 episodes.length >= 1
  const completed = allProjects.filter(
    p => p.status === 'exported' || (p.episodes && p.episodes.length >= 1)
  );

  return completed.map(p => {
    // 确保 ELO 记录存在
    ensureELO(p.id);

    // 查询 ELO
    const eloStmt = d.prepare('SELECT elo FROM arena_elo WHERE screenplay_id = ?');
    eloStmt.bind([p.id]);
    let elo = 1200;
    if (eloStmt.step()) {
      elo = (eloStmt.getAsObject() as { elo: number }).elo;
    }
    eloStmt.free();

    // 查询最新评分
    let latestScore: DimensionScores | undefined;
    const scoreStmt = d.prepare(
      'SELECT final_score FROM arena_scores WHERE screenplay_id = ? ORDER BY created_at DESC LIMIT 1'
    );
    scoreStmt.bind([p.id]);
    if (scoreStmt.step()) {
      try {
        latestScore = JSON.parse((scoreStmt.getAsObject() as { final_score: string }).final_score);
      } catch { /* 解析失败则忽略 */ }
    }
    scoreStmt.free();

    // 查询进化代数（取最大 generation，无记录则为 0）
    let generation = 0;
    const evoStmt = d.prepare(
      'SELECT MAX(generation) as gen FROM arena_evolutions WHERE target_screenplay_id = ?'
    );
    evoStmt.bind([p.id]);
    if (evoStmt.step()) {
      const row = evoStmt.getAsObject() as { gen: number | null };
      if (row.gen !== null) generation = row.gen;
    }
    evoStmt.free();

    return {
      id: p.id,
      title: p.selectedTitle || p.config?.genres?.join('/') || '未命名剧本',
      episodeCount: p.episodes?.length || 0,
      elo,
      latestScore,
      generation,
      createdAt: p.createdAt,
    };
  });
}

// ============================================================
// 评审团 System Prompt 模板
// ============================================================

/** 各评审角色的 System Prompt 模板 */
const REVIEW_PROMPTS: Record<ReviewRole, string> = {
  hitScreenwriter: `你是一位抖音/快手头部短剧爆款编剧，拥有多部播放量过亿的短剧作品。
你的评判标准基于真实短剧行业方法论：

【节奏与结构】
- 前3集是否在30秒内建立核心冲突
- 是否遵循"起势-攀升-风暴-决战"四段式节奏曲线
- 每2-3集是否有小高潮推动剧情
- 结尾钩子是否足够制造追更欲望

【付费设计】
- 第8-12集是否设置首个付费卡点
- 付费卡点是否自然融入剧情而非生硬打断
- 爽点密度是否足够驱动付费转化

【爆款热词命中度】
基于 TOP100 爆款漫剧高频热词知识库评估：
- 核心词根：重生(×9)、开局(×6)、穿越(×5)、觉醒(×3)
- 玄幻修仙：玄幻/仙尊/武道(×10)、大帝/圣王/魔帝(×6)
- 都市：都市/警神/职场(×8)、神医/商战(×4)
- 末世/灵异(×7)、历史(×7)、脑洞(×4)
- 功能元素：系统/转职(×5)、觉醒→能力激活/读心术/隐藏天赋
- 核心指向匹配：重生→改命逆袭、开局→圣体/嗜血血统/捡漏SSS级、穿越→跨世界/异界/反派

请对以下剧本进行六维度评分（每项0-10分），并给出专业点评：
1. 剧情结构  2. 人物塑造  3. 对白质量  4. 节奏把控  5. 创意新颖度  6. 商业潜力`,

  platformReviewer: `你是一位短剧平台资深内容审核官，负责评估剧本的商业价值和平台适配度。
你的评判标准：

【题材热度】（参照 TOP100 爆款频次排名）
- 最热赛道：玄幻修仙(×10)
- 高热赛道：重生(×9)、都市(×8)
- 中热赛道：末世/灵异(×7)、历史(×7)
- 潜力赛道：脑洞(×4)

【商业评估】
- 受众定位是否精准（男频/女频/全年龄）
- 付费卡点设计是否自然不生硬
- 商业变现路径是否清晰
- 是否融合高频功能元素（系统/转职×5、觉醒→能力激活/读心术/隐藏天赋）

【合规性】
- 内容是否符合平台审核标准
- 价值观导向是否正向

请对以下剧本进行六维度评分（每项0-10分），并给出专业点评：
1. 剧情结构  2. 人物塑造  3. 对白质量  4. 节奏把控  5. 创意新颖度  6. 商业潜力`,

  audienceProxy: `你是一位{audience}短剧的忠实观众，每天刷短剧超过2小时。
你的评判完全基于观看体验：

- 代入感：能否在前3集就代入主角视角
- 情感共鸣：剧情是否触动你的情绪（爽感/虐心/甜蜜/紧张）
- 角色讨喜度：主角是否让你想支持，反派是否让你恨得牙痒
- 付费意愿：看到付费卡点时是否愿意掏钱追更
- 追更欲望：每集结尾是否让你忍不住想看下一集

请对以下剧本进行六维度评分（每项0-10分），并给出你作为观众的真实感受：
1. 剧情结构  2. 人物塑造  3. 对白质量  4. 节奏把控  5. 创意新颖度  6. 商业潜力`,

  authorAgent: `你是这部剧本的原创作者 Agent。以下是你的创作身份和风格：
{agentSystemPrompt}

请从创作者视角评判这部剧本是否忠实于你的原始创作意图：
- 故事核心是否与你的创作方向一致
- 人物性格是否符合你的设定
- 叙事风格是否保持了你的特色
- 创意元素是否得到充分发挥

请对以下剧本进行六维度评分（每项0-10分），并给出创作者视角的点评：
1. 剧情结构  2. 人物塑造  3. 对白质量  4. 节奏把控  5. 创意新颖度  6. 商业潜力`,
};

// ============================================================
// 评审团权重
// ============================================================

/** 标准权重（4 角色全部可用） */
export const ROLE_WEIGHTS: Record<string, number> = {
  hitScreenwriter: 0.4,
  platformReviewer: 0.25,
  audienceProxy: 0.25,
  authorAgent: 0.1,
};

/** 回退权重（authorAgent 不可用时） */
export const FALLBACK_WEIGHTS: Record<string, number> = {
  hitScreenwriter: 0.5,
  platformReviewer: 0.3,
  audienceProxy: 0.2,
};

// ============================================================
// Prompt 动态参数替换
// ============================================================

/**
 * 获取指定评审角色的 System Prompt，支持动态参数替换
 * @param role 评审角色
 * @param audience 受众类型（用于 AudienceProxy），默认 '全年龄'
 * @param agentSystemPrompt 作者 Agent 的 system prompt（用于 AuthorAgent）
 */
export function getReviewPrompt(
  role: ReviewRole,
  audience?: string,
  agentSystemPrompt?: string
): string {
  let prompt = REVIEW_PROMPTS[role];

  if (role === 'audienceProxy') {
    prompt = prompt.replace('{audience}', audience || '全年龄');
  }

  if (role === 'authorAgent') {
    prompt = prompt.replace('{agentSystemPrompt}', agentSystemPrompt || '');
  }

  return prompt;
}


// ============================================================
// 剧本内容构建（供 LLM 评审使用）
// ============================================================

/** 六维度 key 列表，用于遍历 */
const DIMENSION_KEYS: (keyof DimensionScores)[] = [
  'plotStructure', 'characterization', 'dialogueQuality',
  'pacing', 'creativity', 'commercialPotential',
];

/** 将分数限制在 [0, 10] 范围内 */
function clampScore(v: number): number {
  return Math.max(0, Math.min(10, Number(v) || 0));
}

/**
 * 构建剧本内容字符串，供 LLM 评审使用
 * 包含标题、题材、受众、集数和各集摘要
 */
function buildScreenplayContent(project: /* ScreenplayProject */ any): string {
  const parts: string[] = [];

  const title = project.selectedTitle || '未命名剧本';
  parts.push(`【剧本标题】${title}`);

  if (project.config?.genres?.length) {
    parts.push(`【题材】${project.config.genres.join('、')}`);
  }
  if (project.config?.audience) {
    parts.push(`【受众】${project.config.audience}`);
  }

  const epCount = project.episodes?.length || 0;
  parts.push(`【集数】共 ${epCount} 集`);

  // 各集摘要
  if (project.episodes?.length) {
    parts.push('\n【各集概要】');
    for (const ep of project.episodes) {
      const sceneSummary = ep.scenes
        ?.map((s: any) => `${s.location}: ${s.description?.slice(0, 80) || ''}`)
        .join('；') || '';
      parts.push(`第${ep.number}集「${ep.title}」— ${sceneSummary}`);
    }
  }

  return parts.join('\n');
}

// ============================================================
// scoreScreenplay — 评审团评分
// ============================================================

/** LLM 返回的评分 JSON 结构 */
interface LLMScoreResponse {
  scores: Record<string, number>;
  comments: Record<string, string>;
}

/**
 * 对剧本进行评审团评分
 * @param screenplayId 剧本 ID
 * @param mode 'single' 单角色 | 'panel' 评审团
 * @param roleKey 单角色模式时指定的角色
 */
export async function scoreScreenplay(
  screenplayId: string,
  mode: 'single' | 'panel',
  roleKey?: ReviewRole
): Promise<ArenaScoreResult> {
  // 1. 获取剧本
  const project = getScreenplay(screenplayId);
  if (!project) throw new Error(`剧本不存在: ${screenplayId}`);

  // 2. 构建 LLM 用户内容
  const content = buildScreenplayContent(project);

  // 3. 确定评审角色列表
  const audience = project.config?.audience || '全年龄';
  const agentId = project.config?.agentId;
  let agentSystemPrompt: string | undefined;

  if (agentId) {
    const agent = getAgentById(agentId);
    if (agent?.system_prompt) {
      agentSystemPrompt = agent.system_prompt;
    }
  }

  let roles: ReviewRole[];
  if (mode === 'single') {
    if (!roleKey) throw new Error('单角色模式必须指定 roleKey');
    roles = [roleKey];
  } else {
    // panel 模式：4 角色，authorAgent 仅在有 agentId 且能获取 prompt 时可用
    roles = ['hitScreenwriter', 'platformReviewer', 'audienceProxy'];
    if (agentId && agentSystemPrompt) {
      roles.push('authorAgent');
    }
  }

  // 4. 依次调用各角色 LLM 评分
  const roleScores: RoleScoreResult[] = [];
  const skippedRoles: ReviewRole[] = [];

  for (const role of roles) {
    const systemPrompt = getReviewPrompt(role, audience, agentSystemPrompt);
    const result = await chatCompletionJSON<LLMScoreResponse>(systemPrompt, content);

    if (!result.success || !result.data?.scores) {
      skippedRoles.push(role);
      continue;
    }

    // 解析并 clamp 分数
    const scores: DimensionScores = {
      plotStructure: clampScore(result.data.scores.plotStructure),
      characterization: clampScore(result.data.scores.characterization),
      dialogueQuality: clampScore(result.data.scores.dialogueQuality),
      pacing: clampScore(result.data.scores.pacing),
      creativity: clampScore(result.data.scores.creativity),
      commercialPotential: clampScore(result.data.scores.commercialPotential),
    };

    const comments = {} as Record<keyof DimensionScores, string>;
    for (const key of DIMENSION_KEYS) {
      comments[key] = result.data.comments?.[key] || '';
    }

    roleScores.push({ role, scores, comments, weight: 0 }); // weight 后续计算
  }

  // 5. 全部失败则抛错
  if (roleScores.length === 0) {
    throw new Error('所有评审角色 LLM 调用均失败，无法生成评分');
  }

  // 6. 计算权重
  const hasAuthorAgent = roleScores.some(r => r.role === 'authorAgent');
  const baseWeights = hasAuthorAgent ? ROLE_WEIGHTS : FALLBACK_WEIGHTS;

  // 归一化：仅对成功角色的权重求和后归一化
  const availableWeightSum = roleScores.reduce(
    (sum, r) => sum + (baseWeights[r.role] || 0), 0
  );

  for (const rs of roleScores) {
    rs.weight = availableWeightSum > 0
      ? (baseWeights[rs.role] || 0) / availableWeightSum
      : 1 / roleScores.length;
  }

  // 7. 加权汇总各维度
  const finalScores: DimensionScores = {
    plotStructure: 0, characterization: 0, dialogueQuality: 0,
    pacing: 0, creativity: 0, commercialPotential: 0,
  };

  for (const key of DIMENSION_KEYS) {
    let weighted = 0;
    for (const rs of roleScores) {
      weighted += rs.scores[key] * rs.weight;
    }
    finalScores[key] = Math.round(weighted * 10) / 10; // 保留一位小数
  }

  // 8. 合并各角色点评
  const finalComments = {} as Record<keyof DimensionScores, string>;
  for (const key of DIMENSION_KEYS) {
    const parts: string[] = [];
    for (const rs of roleScores) {
      if (rs.comments[key]) {
        const roleName = getRoleDisplayName(rs.role);
        parts.push(`【${roleName}】${rs.comments[key]}`);
      }
    }
    finalComments[key] = parts.join('\n');
  }

  // 9. 持久化存储
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const d = getDB();
  d.run(
    `INSERT INTO arena_scores (id, screenplay_id, mode, role_scores, final_score, skipped_roles, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      screenplayId,
      mode,
      JSON.stringify(roleScores),
      JSON.stringify(finalScores),
      JSON.stringify(skippedRoles),
      createdAt,
    ]
  );
  saveDB();

  // 10. 返回结果
  return {
    id,
    screenplayId,
    mode,
    roleScores,
    finalScores,
    finalComments,
    skippedRoles,
    createdAt,
  };
}

/** 角色显示名称映射 */
function getRoleDisplayName(role: ReviewRole): string {
  const names: Record<ReviewRole, string> = {
    hitScreenwriter: '爆款编剧',
    platformReviewer: '平台审核官',
    audienceProxy: '观众代表',
    authorAgent: '作者Agent',
  };
  return names[role] || role;
}


// ============================================================
// ELO 查询
// ============================================================

/** 获取剧本当前 ELO 积分，不存在则返回 1200 */
export function getELO(screenplayId: string): number {
  const d = getDB();
  const stmt = d.prepare('SELECT elo FROM arena_elo WHERE screenplay_id = ?');
  stmt.bind([screenplayId]);
  let elo = 1200;
  if (stmt.step()) {
    elo = (stmt.getAsObject() as { elo: number }).elo;
  }
  stmt.free();
  return elo;
}

// ============================================================
// battleScreenplays — 剧本对战
// ============================================================

/** LLM 对战评判返回的 JSON 结构 */
interface LLMBattleResponse {
  dimensions: Array<{
    dimension: string;
    scoreA: number;
    scoreB: number;
    winner: string;
    comment: string;
  }>;
  finalVerdict: string;
  improvementSuggestions: string[];
}

const BATTLE_SYSTEM_PROMPT = `你是一位资深短剧评审专家。请对以下两部剧本进行六维度逐项对比评判。

对于每个维度，给出两部剧本各自的分数（0-10分）、胜方判定（a/b/draw）和对比点评。
最后给出总裁决和败方改进建议。

请以 JSON 格式返回：
{
  "dimensions": [
    { "dimension": "plotStructure", "scoreA": 8, "scoreB": 6, "winner": "a", "comment": "..." },
    { "dimension": "characterization", "scoreA": 7, "scoreB": 8, "winner": "b", "comment": "..." },
    { "dimension": "dialogueQuality", "scoreA": 7, "scoreB": 7, "winner": "draw", "comment": "..." },
    { "dimension": "pacing", "scoreA": 8, "scoreB": 6, "winner": "a", "comment": "..." },
    { "dimension": "creativity", "scoreA": 6, "scoreB": 7, "winner": "b", "comment": "..." },
    { "dimension": "commercialPotential", "scoreA": 8, "scoreB": 7, "winner": "a", "comment": "..." }
  ],
  "finalVerdict": "a",
  "improvementSuggestions": ["建议1", "建议2"]
}`;

/**
 * 两个剧本 1v1 对战
 * 调用 LLM 进行六维度逐项对比，更新 ELO，持久化对战记录
 * LLM 失败时抛出错误，不更新 ELO（Requirements 3.8）
 */
export async function battleScreenplays(
  screenplayIdA: string,
  screenplayIdB: string
): Promise<BattleResult> {
  // 1. 获取两个剧本
  const projectA = getScreenplay(screenplayIdA);
  if (!projectA) throw new Error(`剧本不存在: ${screenplayIdA}`);
  const projectB = getScreenplay(screenplayIdB);
  if (!projectB) throw new Error(`剧本不存在: ${screenplayIdB}`);

  // 2. 构建剧本内容
  const contentA = buildScreenplayContent(projectA);
  const contentB = buildScreenplayContent(projectB);
  const userMessage = `【剧本 A】\n${contentA}\n\n【剧本 B】\n${contentB}`;

  // 3. 调用 LLM 进行对战评判 — 失败时直接抛错，不更新 ELO
  const result = await chatCompletionJSON<LLMBattleResponse>(BATTLE_SYSTEM_PROMPT, userMessage);
  if (!result.success || !result.data?.dimensions) {
    throw new Error(`对战评判 LLM 调用失败: ${result.error || '未返回有效数据'}`);
  }

  // 4. 解析维度结果，验证并 clamp 分数
  const dimensionResults: DimensionBattleResult[] = DIMENSION_KEYS.map(key => {
    const raw = result.data!.dimensions.find(d => d.dimension === key);
    const scoreA = clampScore(raw?.scoreA ?? 0);
    const scoreB = clampScore(raw?.scoreB ?? 0);
    // winner 判定基于分数大小关系，而非 LLM 返回值
    let winner: 'a' | 'b' | 'draw';
    if (scoreA > scoreB) winner = 'a';
    else if (scoreB > scoreA) winner = 'b';
    else winner = 'draw';

    return {
      dimension: key,
      scoreA,
      scoreB,
      winner,
      comment: raw?.comment || '',
    };
  });

  // 5. 根据维度胜负计数确定 finalVerdict
  let winsA = 0;
  let winsB = 0;
  for (const dr of dimensionResults) {
    if (dr.winner === 'a') winsA++;
    else if (dr.winner === 'b') winsB++;
  }
  let finalVerdict: 'a' | 'b' | 'draw';
  if (winsA > winsB) finalVerdict = 'a';
  else if (winsB > winsA) finalVerdict = 'b';
  else finalVerdict = 'draw';

  const improvementSuggestions = result.data.improvementSuggestions || [];

  // 6. 获取当前 ELO 并计算更新
  ensureELO(screenplayIdA);
  ensureELO(screenplayIdB);
  const eloA = getELO(screenplayIdA);
  const eloB = getELO(screenplayIdB);

  const scoreA = finalVerdict === 'a' ? 1 : finalVerdict === 'b' ? 0 : 0.5;
  const { newRatingA, newRatingB } = updateELO(eloA, eloB, scoreA);
  const eloChangeA = newRatingA - eloA;
  const eloChangeB = newRatingB - eloB;

  // 7. 持久化：更新 ELO 和对战记录
  const battleId = crypto.randomUUID();
  const createdAt = Date.now();
  const d = getDB();

  // 更新 A 的 ELO 和战绩
  const winsIncA = finalVerdict === 'a' ? 1 : 0;
  const lossesIncA = finalVerdict === 'b' ? 1 : 0;
  const drawsIncA = finalVerdict === 'draw' ? 1 : 0;
  d.run(
    `UPDATE arena_elo SET elo = ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at = ? WHERE screenplay_id = ?`,
    [newRatingA, winsIncA, lossesIncA, drawsIncA, createdAt, screenplayIdA]
  );

  // 更新 B 的 ELO 和战绩
  const winsIncB = finalVerdict === 'b' ? 1 : 0;
  const lossesIncB = finalVerdict === 'a' ? 1 : 0;
  const drawsIncB = finalVerdict === 'draw' ? 1 : 0;
  d.run(
    `UPDATE arena_elo SET elo = ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at = ? WHERE screenplay_id = ?`,
    [newRatingB, winsIncB, lossesIncB, drawsIncB, createdAt, screenplayIdB]
  );

  // 存储对战记录
  d.run(
    `INSERT INTO arena_battles (id, screenplay_id_a, screenplay_id_b, dimension_results, final_verdict, improvement_suggestions, elo_change_a, elo_change_b, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      battleId,
      screenplayIdA,
      screenplayIdB,
      JSON.stringify(dimensionResults),
      finalVerdict,
      JSON.stringify(improvementSuggestions),
      eloChangeA,
      eloChangeB,
      createdAt,
    ]
  );

  saveDB();

  // 8. 返回对战结果
  return {
    id: battleId,
    screenplayIdA,
    screenplayIdB,
    dimensionResults,
    finalVerdict,
    improvementSuggestions,
    eloChangeA,
    eloChangeB,
    createdAt,
  };
}


// ============================================================
// 锦标赛 — 辅助函数
// ============================================================

/** Fisher-Yates 洗牌算法 */
function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 生成淘汰赛赛程
 * 随机打乱参赛者，相邻两两配对，奇数时最后一个轮空晋级
 * 返回所有轮次（从第一轮到决赛）
 */
export function generateEliminationBracket(ids: string[]): TournamentRound[] {
  const rounds: TournamentRound[] = [];
  let currentIds = shuffleArray(ids);
  let roundNumber = 1;

  while (currentIds.length > 1) {
    const matches: TournamentMatch[] = [];
    const nextRoundIds: string[] = [];

    for (let i = 0; i < currentIds.length; i += 2) {
      if (i + 1 < currentIds.length) {
        // 正常配对
        matches.push({
          screenplayIdA: currentIds[i],
          screenplayIdB: currentIds[i + 1],
        });
      } else {
        // 奇数，最后一个轮空
        matches.push({
          screenplayIdA: currentIds[i],
          screenplayIdB: null,
          winner: currentIds[i], // 轮空自动晋级
        });
        nextRoundIds.push(currentIds[i]);
      }
    }

    rounds.push({ roundNumber, matches });
    // nextRoundIds 中已有轮空晋级者，正常对战的 winner 在执行时填入
    currentIds = nextRoundIds; // 先放轮空者，后续执行时追加对战胜者
    roundNumber++;
  }

  return rounds;
}

/**
 * 生成循环赛赛程
 * 所有 N*(N-1)/2 个唯一配对，放在一个轮次中
 */
export function generateRoundRobinSchedule(ids: string[]): TournamentRound[] {
  const matches: TournamentMatch[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      matches.push({
        screenplayIdA: ids[i],
        screenplayIdB: ids[j],
      });
    }
  }
  return [{ roundNumber: 1, matches }];
}

// ============================================================
// startTournament — 锦标赛主函数
// ============================================================

/**
 * 启动锦标赛（后台异步执行）
 * 支持淘汰赛和循环赛两种赛制，复用 battleScreenplays 执行每场对战
 * 通过 wsManager 推送实时进度，持久化赛程和结果
 */
export async function startTournament(
  screenplayIds: string[],
  format: 'elimination' | 'round-robin',
  taskId: string
): Promise<TournamentResult> {
  const startTime = Date.now();

  // 1. 验证：至少 3 个剧本，且都存在
  if (screenplayIds.length < 3) {
    throw new Error('锦标赛至少需要 3 个剧本');
  }
  for (const id of screenplayIds) {
    const project = getScreenplay(id);
    if (!project) throw new Error(`剧本不存在: ${id}`);
  }

  // 2. 初始化锦标赛记录
  const tournamentId = crypto.randomUUID();
  const d = getDB();

  const initialRounds = format === 'elimination'
    ? generateEliminationBracket(screenplayIds)
    : generateRoundRobinSchedule(screenplayIds);

  const tournament: TournamentResult = {
    id: tournamentId,
    format,
    screenplayIds,
    rounds: initialRounds,
    championId: null,
    status: 'running',
  };

  d.run(
    `INSERT INTO arena_tournaments (id, format, screenplay_ids, bracket, results, champion_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tournamentId,
      format,
      JSON.stringify(screenplayIds),
      JSON.stringify(initialRounds),
      JSON.stringify({}),
      null,
      'running',
      startTime,
    ]
  );
  saveDB();

  // 获取剧本标题的辅助函数
  const getTitle = (id: string): string => {
    const p = getScreenplay(id);
    return p?.selectedTitle || p?.config?.genres?.join('/') || '未命名剧本';
  };

  try {
    if (format === 'elimination') {
      await runEliminationTournament(tournament, taskId, startTime, getTitle);
    } else {
      await runRoundRobinTournament(tournament, taskId, startTime, getTitle);
    }

    // 更新锦标赛状态为完成
    tournament.status = 'completed';
    d.run(
      `UPDATE arena_tournaments SET bracket = ?, results = ?, champion_id = ?, status = 'completed', completed_at = ? WHERE id = ?`,
      [
        JSON.stringify(tournament.rounds),
        JSON.stringify(tournament.rounds),
        tournament.championId,
        Date.now(),
        tournamentId,
      ]
    );
    saveDB();

    // 广播完成
    wsManager.broadcast(taskId, {
      id: taskId,
      status: 'done',
      progress: `锦标赛完成！冠军: ${tournament.championId ? getTitle(tournament.championId) : '未知'}`,
      startTime,
      result: tournament as any,
      error: null,
    });
  } catch (err: any) {
    // 错误处理：更新状态，广播错误
    tournament.status = 'pending'; // 标记为未完成，允许重试
    d.run(
      `UPDATE arena_tournaments SET bracket = ?, status = 'error' WHERE id = ?`,
      [JSON.stringify(tournament.rounds), tournamentId]
    );
    saveDB();

    wsManager.broadcast(taskId, {
      id: taskId,
      status: 'error',
      progress: '',
      startTime,
      result: null,
      error: err.message || '锦标赛执行失败',
    });

    throw err;
  }

  return tournament;
}


// ============================================================
// 淘汰赛执行逻辑
// ============================================================

/**
 * 执行淘汰赛：逐轮执行对战，胜者晋级，直到决出冠军
 * 每轮结束后动态生成下一轮赛程
 */
async function runEliminationTournament(
  tournament: TournamentResult,
  taskId: string,
  startTime: number,
  getTitle: (id: string) => string
): Promise<void> {
  // 初始参赛者
  let currentIds = shuffleArray([...tournament.screenplayIds]);
  tournament.rounds = []; // 重新生成，因为需要动态构建每轮

  let roundNumber = 0;
  // 计算总轮数用于进度显示
  const totalRounds = Math.ceil(Math.log2(currentIds.length));

  while (currentIds.length > 1) {
    roundNumber++;
    const matches: TournamentMatch[] = [];
    const nextRoundIds: string[] = [];

    // 配对
    for (let i = 0; i < currentIds.length; i += 2) {
      if (i + 1 < currentIds.length) {
        matches.push({
          screenplayIdA: currentIds[i],
          screenplayIdB: currentIds[i + 1],
        });
      } else {
        // 轮空
        const byeId = currentIds[i];
        matches.push({
          screenplayIdA: byeId,
          screenplayIdB: null,
          winner: byeId,
        });
        nextRoundIds.push(byeId);

        // 广播轮空信息
        wsManager.broadcast(taskId, {
          id: taskId,
          status: 'processing',
          progress: `Round ${roundNumber}/${totalRounds}: ${getTitle(byeId)} 轮空晋级`,
          startTime,
          result: null,
          error: null,
        });
      }
    }

    // 执行本轮所有非轮空对战
    for (const match of matches) {
      if (match.screenplayIdB === null) continue; // 轮空已处理

      const titleA = getTitle(match.screenplayIdA);
      const titleB = getTitle(match.screenplayIdB);

      // 广播当前对战进度
      wsManager.broadcast(taskId, {
        id: taskId,
        status: 'processing',
        progress: `Round ${roundNumber}/${totalRounds}: ${titleA} vs ${titleB}`,
        startTime,
        result: null,
        error: null,
      });

      // 执行对战
      const battleResult = await battleScreenplays(match.screenplayIdA, match.screenplayIdB);
      match.battleId = battleResult.id;

      // 确定胜者
      if (battleResult.finalVerdict === 'a') {
        match.winner = match.screenplayIdA;
      } else if (battleResult.finalVerdict === 'b') {
        match.winner = match.screenplayIdB;
      } else {
        // 平局时 A 方晋级（淘汰赛必须决出胜负）
        match.winner = match.screenplayIdA;
      }

      nextRoundIds.push(match.winner!);
    }

    tournament.rounds.push({ roundNumber, matches });

    // 每轮结束后持久化当前进度
    const d = getDB();
    d.run(
      `UPDATE arena_tournaments SET bracket = ?, results = ? WHERE id = ?`,
      [JSON.stringify(tournament.rounds), JSON.stringify(tournament.rounds), tournament.id]
    );
    saveDB();

    currentIds = nextRoundIds;
  }

  // 最后剩余的就是冠军
  tournament.championId = currentIds[0] || null;
}

// ============================================================
// 循环赛执行逻辑
// ============================================================

/**
 * 执行循环赛：所有参赛者两两对战一次
 * 最终按胜场数排名，胜场相同时按 ELO 排序
 */
async function runRoundRobinTournament(
  tournament: TournamentResult,
  taskId: string,
  startTime: number,
  getTitle: (id: string) => string
): Promise<void> {
  const matches = tournament.rounds[0]?.matches || [];
  const totalMatches = matches.length;

  // 胜场统计
  const winCounts = new Map<string, number>();
  for (const id of tournament.screenplayIds) {
    winCounts.set(id, 0);
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match.screenplayIdB) continue; // 循环赛不应有轮空

    const titleA = getTitle(match.screenplayIdA);
    const titleB = getTitle(match.screenplayIdB);

    // 广播进度
    wsManager.broadcast(taskId, {
      id: taskId,
      status: 'processing',
      progress: `Round 1/1: ${titleA} vs ${titleB} (${i + 1}/${totalMatches})`,
      startTime,
      result: null,
      error: null,
    });

    // 执行对战
    const battleResult = await battleScreenplays(match.screenplayIdA, match.screenplayIdB);
    match.battleId = battleResult.id;

    if (battleResult.finalVerdict === 'a') {
      match.winner = match.screenplayIdA;
      winCounts.set(match.screenplayIdA, (winCounts.get(match.screenplayIdA) || 0) + 1);
    } else if (battleResult.finalVerdict === 'b') {
      match.winner = match.screenplayIdB;
      winCounts.set(match.screenplayIdB, (winCounts.get(match.screenplayIdB) || 0) + 1);
    } else {
      // 平局：双方各加 0.5 胜场（用整数近似，不影响排名逻辑）
      match.winner = undefined;
    }

    // 每场对战后持久化
    const d = getDB();
    d.run(
      `UPDATE arena_tournaments SET bracket = ?, results = ? WHERE id = ?`,
      [JSON.stringify(tournament.rounds), JSON.stringify(tournament.rounds), tournament.id]
    );
    saveDB();
  }

  // 决定冠军：胜场最多者，平局时按 ELO 排序
  let champion: string | null = null;
  let maxWins = -1;
  let maxElo = -1;

  for (const id of tournament.screenplayIds) {
    const wins = winCounts.get(id) || 0;
    const elo = getELO(id);
    if (wins > maxWins || (wins === maxWins && elo > maxElo)) {
      maxWins = wins;
      maxElo = elo;
      champion = id;
    }
  }

  tournament.championId = champion;
}


// ============================================================
// 排行榜查询
// ============================================================

/**
 * 获取 ELO 排行榜，按 ELO 降序排列
 * 包含胜率计算和最新评分
 */
export function getLeaderboard(): LeaderboardEntry[] {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM arena_elo ORDER BY elo DESC');
  const entries: LeaderboardEntry[] = [];

  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      screenplay_id: string; elo: number;
      wins: number; losses: number; draws: number;
    };
    const project = getScreenplay(row.screenplay_id);
    if (!project) continue;

    const total = row.wins + row.losses + row.draws;
    const winRate = total > 0 ? row.wins / total : 0;

    // 获取最新评分
    let latestScore: DimensionScores | undefined;
    const scoreStmt = d.prepare(
      'SELECT final_score FROM arena_scores WHERE screenplay_id = ? ORDER BY created_at DESC LIMIT 1'
    );
    scoreStmt.bind([row.screenplay_id]);
    if (scoreStmt.step()) {
      try { latestScore = JSON.parse((scoreStmt.getAsObject() as any).final_score); } catch { /* ignore */ }
    }
    scoreStmt.free();

    entries.push({
      screenplayId: row.screenplay_id,
      title: project.selectedTitle || project.config?.genres?.join('/') || '未命名剧本',
      elo: row.elo,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      winRate: Math.round(winRate * 1000) / 1000,
      latestScore,
    });
  }
  stmt.free();
  return entries;
}

// ============================================================
// 剧本角斗场历史查询
// ============================================================

/**
 * 获取指定剧本的角斗场历史记录
 * 包含对战记录、进化谱系和评分历史
 */
export function getScreenplayHistory(screenplayId: string): ScreenplayArenaHistory {
  const d = getDB();

  // 对战记录
  const battleStmt = d.prepare(
    'SELECT * FROM arena_battles WHERE screenplay_id_a = ? OR screenplay_id_b = ? ORDER BY created_at DESC'
  );
  battleStmt.bind([screenplayId, screenplayId]);
  const battles: BattleResult[] = [];
  while (battleStmt.step()) {
    const row = battleStmt.getAsObject() as any;
    battles.push({
      id: row.id,
      screenplayIdA: row.screenplay_id_a,
      screenplayIdB: row.screenplay_id_b,
      dimensionResults: JSON.parse(row.dimension_results),
      finalVerdict: row.final_verdict,
      improvementSuggestions: JSON.parse(row.improvement_suggestions || '[]'),
      eloChangeA: row.elo_change_a,
      eloChangeB: row.elo_change_b,
      createdAt: row.created_at,
    });
  }
  battleStmt.free();

  // 进化记录
  const evoStmt = d.prepare(
    'SELECT * FROM arena_evolutions WHERE source_screenplay_id = ? OR target_screenplay_id = ? ORDER BY created_at DESC'
  );
  evoStmt.bind([screenplayId, screenplayId]);
  const evolutions: EvolutionRecord[] = [];
  while (evoStmt.step()) {
    const row = evoStmt.getAsObject() as any;
    evolutions.push({
      id: row.id,
      sourceScreenplayId: row.source_screenplay_id,
      targetScreenplayId: row.target_screenplay_id,
      winnerScreenplayId: row.winner_screenplay_id,
      battleId: row.battle_id,
      absorbedElements: JSON.parse(row.absorbed_elements),
      evolutionType: row.evolution_type,
      generation: row.generation,
      createdAt: row.created_at,
    });
  }
  evoStmt.free();

  // 评分历史
  const scoreStmt = d.prepare(
    'SELECT * FROM arena_scores WHERE screenplay_id = ? ORDER BY created_at DESC'
  );
  scoreStmt.bind([screenplayId]);
  const scores: ArenaScoreResult[] = [];
  while (scoreStmt.step()) {
    const row = scoreStmt.getAsObject() as any;
    scores.push({
      id: row.id,
      screenplayId: row.screenplay_id,
      mode: row.mode,
      roleScores: JSON.parse(row.role_scores),
      finalScores: JSON.parse(row.final_score),
      finalComments: {} as Record<keyof DimensionScores, string>,
      skippedRoles: JSON.parse(row.skipped_roles || '[]'),
      createdAt: row.created_at,
    });
  }
  scoreStmt.free();

  return { screenplayId, battles, evolutions, scores };
}

// ============================================================
// 进化机制
// ============================================================

const VALID_EVOLUTION_CATEGORIES = ['plot', 'character', 'dialogue', 'pacing', 'scene', 'style'] as const;

/**
 * 生成进化方案：分析胜方优秀元素，返回 EvolutionPlan
 */
export async function generateEvolutionPlan(
  loserId: string,
  winnerId: string,
  battleId: string
): Promise<EvolutionPlan> {
  const loser = getScreenplay(loserId);
  const winner = getScreenplay(winnerId);
  if (!loser) throw new Error(`败方剧本不存在: ${loserId}`);
  if (!winner) throw new Error(`胜方剧本不存在: ${winnerId}`);

  const loserContent = buildScreenplayContent(loser);
  const winnerContent = buildScreenplayContent(winner);

  const systemPrompt = `你是一位资深剧本顾问，擅长分析剧本优劣并提出改进方案。
请分析胜方剧本的优秀元素，为败方剧本生成一份进化方案。

你需要从以下六个类别中提取胜方的优秀元素：
- plot: 情节设计（剧情结构、冲突设置、转折点等）
- character: 人物弧线（角色塑造、成长轨迹、关系网络等）
- dialogue: 对白风格（台词质量、语言特色、情感表达等）
- pacing: 节奏技巧（叙事节奏、悬念设置、高潮安排等）
- scene: 场景构造（场景设计、氛围营造、视觉化描写等）
- style: 叙事风格（整体风格、叙事手法、创意元素等）

请以 JSON 格式返回，包含 elements 数组，每个元素包含：
- id: 唯一标识（使用 "evo_" 前缀加序号，如 "evo_1"）
- category: 类别（必须是 plot/character/dialogue/pacing/scene/style 之一）
- description: 具体描述该优秀元素
- expectedEffect: 预期改进效果
- sourceDetail: 来自胜方的具体内容引用

请提取 3-8 个最有价值的元素。`;

  const userContent = `【败方剧本】
${loserContent}

【胜方剧本】
${winnerContent}`;

  const result = await chatCompletionJSON<{ elements: EvolutionElement[] }>(systemPrompt, userContent);

  if (!result.success || !result.data) {
    throw new Error(`生成进化方案失败: ${result.error || '未知错误'}`);
  }

  const rawElements = result.data.elements;
  if (!Array.isArray(rawElements) || rawElements.length === 0) {
    throw new Error('进化方案为空，LLM 未返回有效元素');
  }

  // 校验并规范化每个元素
  const elements: EvolutionElement[] = rawElements
    .filter(el => el && typeof el === 'object')
    .map((el, idx) => ({
      id: el.id || crypto.randomUUID(),
      category: VALID_EVOLUTION_CATEGORIES.includes(el.category as any) ? el.category : 'plot',
      description: el.description || '',
      expectedEffect: el.expectedEffect || '',
      sourceDetail: el.sourceDetail || '',
    }))
    .filter(el => el.description && el.expectedEffect);

  if (elements.length === 0) {
    throw new Error('进化方案校验后无有效元素');
  }

  return { elements };
}

/**
 * 执行进化：基于选中元素重构败方剧本，创建新版本
 */
export async function executeEvolution(
  loserId: string,
  winnerId: string,
  selectedElements: string[],
  evolutionType: 'enhance' | 'expand' | 'style_merge' = 'enhance'
): Promise<any> {
  const loser = getScreenplay(loserId);
  const winner = getScreenplay(winnerId);
  if (!loser) throw new Error(`败方剧本不存在: ${loserId}`);
  if (!winner) throw new Error(`胜方剧本不存在: ${winnerId}`);

  // 获取最近一次该败方的进化方案（从最近的 battle 中）
  // 先尝试从 DB 中找到对应的 battle，再生成 plan 来匹配 selectedElements
  const loserContent = buildScreenplayContent(loser);
  const winnerContent = buildScreenplayContent(winner);

  // 构建选中元素的描述（用于 LLM prompt）
  const selectedDesc = selectedElements.length > 0
    ? `用户选中了以下元素 ID 进行吸收: ${selectedElements.join(', ')}`
    : '用户选择吸收所有优秀元素';

  const evolutionTypeDesc: Record<string, string> = {
    enhance: '增强现有元素：优化已有情节和人物，提升质量',
    expand: '扩展新内容：增加新角色、新场景、新情节线',
    style_merge: '风格融合：吸收胜方的对白风格或叙事技巧',
  };

  const systemPrompt = `你是一位资深剧本重构专家。请基于胜方剧本的优秀元素，对败方剧本进行重构进化。

进化方式：${evolutionTypeDesc[evolutionType] || evolutionTypeDesc.enhance}

${selectedDesc}

请对败方剧本进行重构，返回 JSON 格式的重构结果：
{
  "episodes": [
    {
      "number": 1,
      "title": "集标题",
      "scenes": [
        {
          "sceneNumber": 1,
          "location": "场景地点",
          "description": "场景描述",
          "dialogue": [
            { "character": "角色名", "line": "台词" }
          ]
        }
      ]
    }
  ]
}

要求：
1. 保持败方剧本的核心故事框架
2. 融入胜方的优秀元素进行改进
3. 集数与败方剧本保持一致
4. 每集包含完整的场景和对白`;

  const userContent = `【败方剧本（待重构）】
${loserContent}

【胜方剧本（元素来源）】
${winnerContent}`;

  const result = await chatCompletionJSON<{ episodes: any[] }>(systemPrompt, userContent);

  if (!result.success || !result.data) {
    throw new Error(`进化重构失败: ${result.error || '未知错误'}`);
  }

  const evolvedEpisodes = result.data.episodes;
  if (!Array.isArray(evolvedEpisodes) || evolvedEpisodes.length === 0) {
    throw new Error('进化重构结果为空');
  }

  // 创建新的 ScreenplayProject
  const newProject = createScreenplay(loser.config);
  if ('error' in newProject) {
    throw new Error(`创建进化剧本失败: ${newProject.error}`);
  }

  // 更新新项目的内容
  updateScreenplay(newProject.id, {
    status: 'exported',
    episodes: evolvedEpisodes,
    selectedTitle: `${loser.selectedTitle || '未命名剧本'}（进化版）`,
    creativePlan: loser.creativePlan,
    characterDesign: loser.characterDesign,
    episodeDirectory: loser.episodeDirectory,
  });

  // 查询败方当前进化代数
  const d = getDB();
  const genStmt = d.prepare(
    'SELECT MAX(generation) as max_gen FROM arena_evolutions WHERE target_screenplay_id = ?'
  );
  genStmt.bind([loserId]);
  let currentGen = 0;
  if (genStmt.step()) {
    const row = genStmt.getAsObject() as any;
    currentGen = row.max_gen || 0;
  }
  genStmt.free();

  // 记录进化历史
  const evoId = crypto.randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO arena_evolutions (id, source_screenplay_id, target_screenplay_id, winner_screenplay_id, battle_id, absorbed_elements, evolution_type, generation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [evoId, loserId, newProject.id, winnerId, '', JSON.stringify(selectedElements), evolutionType, currentGen + 1, now]
  );
  saveDB();

  // 初始化新剧本的 ELO
  ensureELO(newProject.id);

  return {
    id: newProject.id,
    title: `${loser.selectedTitle || '未命名剧本'}（进化版）`,
    generation: currentGen + 1,
    evolutionType,
    absorbedElements: selectedElements,
    createdAt: now,
  };
}
