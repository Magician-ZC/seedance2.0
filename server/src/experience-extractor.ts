// 经验提取器 - 从已完成项目的历史数据中提取结构化经验
// 支持闭环模式(loop)和竞技模式(arena)两种提取路径

import { chatCompletionJSON } from './llm-service.js';
import { getScreenplay, type ScreenplayProject } from './screenplay-creator.js';
import type { LoopIteration } from './creation-loop.js';
import {
  insertExperience,
  updateExperience,
  listExperiencesBySourceProject,
  type ExperienceRow,
  type ExperienceType,
} from './experience-store.js';
import {
  getArenaSessionByProjectId,
  listArenaCandidatesByStage,
  listArenaReviewsByCandidate,
  listArenaFunnelScoresByStage,
  type ArenaSessionRow,
  type ArenaCandidateRow,
  type ArenaReviewRow,
  type ArenaFunnelScoreRow,
} from './db-service.js';

// ============================================================
// 类型定义
// ============================================================

/** LLM 提取的经验结构（Prompt 输出格式） */
interface ExtractedExperience {
  type: ExperienceType;
  genres: string[];
  audience: string;
  summary: string;
  qualityIndicator: 'high' | 'medium' | 'low';
}

// ============================================================
// 常量
// ============================================================

/** 有效的经验类型集合 */
const VALID_TYPES: ExperienceType[] = ['error_pattern', 'success_pattern', 'genre_rule', 'audience_rule'];

/** qualityIndicator 对质量分数的加权系数 */
const QUALITY_INDICATOR_WEIGHT: Record<string, number> = {
  high: 1.2,
  medium: 1.0,
  low: 0.8,
};

// ============================================================
// 辅助函数（可复用）
// ============================================================

/**
 * 基于闭环模式的 finalScores 计算基础质量分数
 * 取 logicTruth、emotionHook、dialogueStyle 的加权平均
 */
export function calcLoopQualityScore(
  finalScores: { logicTruth: number; emotionHook: number; dialogueStyle: number },
): number {
  // 权重：逻辑真实度 0.35，情绪爽感 0.40，对白风格 0.25
  const raw = finalScores.logicTruth * 0.35
            + finalScores.emotionHook * 0.40
            + finalScores.dialogueStyle * 0.25;
  return Math.round(Math.min(100, Math.max(0, raw)) * 100) / 100;
}

/**
 * 将 LLM 的 qualityIndicator 与基础分数结合，得到最终质量分数
 */
export function applyQualityIndicator(baseScore: number, indicator: string): number {
  const weight = QUALITY_INDICATOR_WEIGHT[indicator] ?? 1.0;
  const adjusted = baseScore * weight;
  return Math.round(Math.min(100, Math.max(0, adjusted)) * 100) / 100;
}

/**
 * 校验并规范化 LLM 提取的单条经验数据
 * 返回 null 表示数据无效，应跳过
 */
export function validateExtractedExperience(raw: unknown): ExtractedExperience | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // type 必须是有效枚举值
  if (!VALID_TYPES.includes(obj.type as ExperienceType)) return null;

  // summary 必须是非空字符串
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null;

  // genres 规范化为字符串数组
  let genres: string[] = [];
  if (Array.isArray(obj.genres)) {
    genres = obj.genres.filter((g): g is string => typeof g === 'string' && g.trim() !== '');
  }

  // audience 规范化
  const audience = typeof obj.audience === 'string' ? obj.audience.trim() : '';

  // qualityIndicator 规范化
  const indicator = typeof obj.qualityIndicator === 'string'
    && ['high', 'medium', 'low'].includes(obj.qualityIndicator)
    ? obj.qualityIndicator as 'high' | 'medium' | 'low'
    : 'medium';

  return {
    type: obj.type as ExperienceType,
    genres,
    audience,
    summary: obj.summary.trim(),
    qualityIndicator: indicator,
  };
}

/**
 * 将闭环迭代记录序列化为 LLM 可读的文本摘要
 */
function serializeLoopIterations(
  loopIterations: Record<string, LoopIteration[]>,
): string {
  const parts: string[] = [];

  for (const [stage, iterations] of Object.entries(loopIterations)) {
    if (!iterations || iterations.length === 0) continue;
    parts.push(`## 阶段: ${stage} (共${iterations.length}轮迭代)`);

    for (const iter of iterations) {
      parts.push(`### ${iter.version}`);

      // 导师审阅
      const mr = iter.mentorReview;
      parts.push(`导师评分: ${mr.score} | 总评: ${mr.summary}`);
      if (mr.feedbacks.length > 0) {
        parts.push('导师反馈:');
        for (const fb of mr.feedbacks.slice(0, 5)) { // 限制条数避免过长
          parts.push(`- [${fb.severity}] ${fb.location}: ${fb.issue} → ${fb.suggestion}`);
        }
      }

      // 人性审阅
      const hr = iter.humanityReview;
      parts.push(`人性评分: ${hr.score} | 总评: ${hr.summary}`);
      if (hr.feedbacks.length > 0) {
        parts.push('人性反馈:');
        for (const fb of hr.feedbacks.slice(0, 5)) {
          parts.push(`- [${fb.severity}] ${fb.location}: ${fb.issue} → ${fb.suggestion}`);
        }
      }

      // 中枢裁决
      const nv = iter.nexusVerdict;
      if (nv.conflictResolutions.length > 0) {
        parts.push(`冲突裁决: ${nv.conflictResolutions.join('; ')}`);
      }
      if (nv.priorityActions.length > 0) {
        parts.push(`优先修改: ${nv.priorityActions.join('; ')}`);
      }
      parts.push(`达标: ${nv.passThreshold ? '是' : '否'} | 分数: 逻辑${nv.scores.logicTruth} 爽感${nv.scores.emotionHook} 对白${nv.scores.dialogueStyle}`);
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * 构建经验提取的 LLM Prompt
 */
function buildExtractionPrompt(
  config: { genres: string[]; audience: string },
  iterationText: string,
): { system: string; user: string } {
  const system = `你是一位资深的剧本创作分析专家。你的任务是从创作项目的闭环迭代记录中提炼出可复用的结构化经验。

请分析以下迭代记录，提取有价值的经验条目。每条经验应属于以下四种类型之一：
- error_pattern: 高频错误模式（反复出现的问题）
- success_pattern: 成功模式（高分方案的共性特征）
- genre_rule: 题材特定的创作规律
- audience_rule: 受众相关的创作规律

返回 JSON 数组，每个元素格式：
{
  "type": "error_pattern" | "success_pattern" | "genre_rule" | "audience_rule",
  "genres": ["适用题材1", "适用题材2"],
  "audience": "适用受众（男频/女频/全年龄，空字符串表示通用）",
  "summary": "经验内容摘要（一段简洁的描述，50-150字）",
  "qualityIndicator": "high" | "medium" | "low"
}

要求：
1. 提取3-8条最有价值的经验，不要过多
2. summary 要具体、可操作，避免空泛的描述
3. 优先提取反复出现的模式和规律
4. qualityIndicator 基于该经验的可靠性和普适性自评`;

  const user = `项目题材: ${config.genres.join(', ') || '未指定'}
项目受众: ${config.audience || '未指定'}

以下是该项目的闭环迭代记录：

${iterationText}`;

  return { system, user };
}

/**
 * 去重存储经验：已有同源经验则更新，否则插入新经验
 */
function deduplicateAndStore(
  newExperiences: ExperienceRow[],
  existingExperiences: ExperienceRow[],
): void {
  // 按 type 建立已有经验索引，用于匹配更新
  const existingByType = new Map<string, ExperienceRow>();
  for (const exp of existingExperiences) {
    existingByType.set(exp.type, exp);
  }

  for (const newExp of newExperiences) {
    const existing = existingByType.get(newExp.type);
    if (existing) {
      // 更新已有经验（保留原 ID 和引用计数）
      updateExperience(existing.id, {
        genres: newExp.genres,
        audience: newExp.audience,
        summary: newExp.summary,
        quality_score: newExp.quality_score,
        source_mode: newExp.source_mode,
      });
      existingByType.delete(newExp.type); // 避免重复匹配
    } else {
      insertExperience(newExp);
    }
  }
}

// ============================================================
// 核心提取函数
// ============================================================

/**
 * 从闭环创作项目中提取经验
 *
 * 流程：
 * 1. 读取项目数据和闭环迭代记录
 * 2. 序列化迭代记录为文本
 * 3. 调用 LLM 分析提炼结构化经验
 * 4. 基于 finalScores 计算质量分数
 * 5. 去重存储经验
 *
 * @param projectId 项目ID
 * @returns 提取的经验列表（空数组表示无可提取经验或提取失败）
 */
export async function extractFromLoopProject(projectId: string): Promise<ExperienceRow[]> {
  // 1. 读取项目数据
  const project = getScreenplay(projectId);
  if (!project) {
    console.log(`[experience-extractor] 项目不存在: ${projectId}`);
    return [];
  }

  // 2. 检查闭环迭代记录
  const loopIterations = project.loopIterations;
  if (!loopIterations || Object.keys(loopIterations).length === 0) {
    console.log(`[experience-extractor] 项目无闭环迭代数据: ${projectId}`);
    return [];
  }

  // 3. 序列化迭代记录
  const iterationText = serializeLoopIterations(loopIterations);
  if (!iterationText.trim()) {
    console.log(`[experience-extractor] 迭代记录为空: ${projectId}`);
    return [];
  }

  // 4. 计算基础质量分数（从最后一轮迭代的分数中取）
  const baseScore = calcBaseScoreFromProject(project);

  // 5. 调用 LLM 提取经验
  let extractedList: ExtractedExperience[];
  try {
    const { system, user } = buildExtractionPrompt(
      { genres: project.config.genres, audience: project.config.audience },
      iterationText,
    );
    const result = await chatCompletionJSON<ExtractedExperience[]>(system, user, { timeoutMs: 120_000 });

    if (!result.success || !result.data) {
      console.error(`[experience-extractor] LLM 提取失败: ${result.error}`);
      return [];
    }

    // 规范化为数组
    const rawData = Array.isArray(result.data) ? result.data : [result.data];
    extractedList = rawData
      .map(item => validateExtractedExperience(item))
      .filter((item): item is ExtractedExperience => item !== null);
  } catch (err) {
    console.error(`[experience-extractor] LLM 调用异常:`, err);
    return [];
  }

  if (extractedList.length === 0) {
    console.log(`[experience-extractor] LLM 未返回有效经验: ${projectId}`);
    return [];
  }

  // 6. 构建 ExperienceRow 列表
  const now = Date.now();
  const experiences: ExperienceRow[] = extractedList.map(ext => ({
    id: crypto.randomUUID(),
    type: ext.type,
    genres: JSON.stringify(ext.genres),
    audience: ext.audience,
    summary: ext.summary,
    source_project_id: projectId,
    source_mode: 'loop' as const,
    quality_score: applyQualityIndicator(baseScore, ext.qualityIndicator),
    reference_count: 0,
    created_at: now,
    updated_at: now,
  }));

  // 7. 去重存储
  const existingExperiences = listExperiencesBySourceProject(projectId);
  deduplicateAndStore(experiences, existingExperiences);

  console.log(`[experience-extractor] 闭环项目 ${projectId} 提取了 ${experiences.length} 条经验`);
  return experiences;
}

// ============================================================
// 内部辅助
// ============================================================

/**
 * 从项目的闭环迭代记录中提取最终分数，计算基础质量分数
 * 取所有阶段最后一轮迭代分数的平均值
 */
function calcBaseScoreFromProject(project: ScreenplayProject): number {
  const loopIterations = project.loopIterations;
  if (!loopIterations) return 50; // 无迭代数据时给默认中等分

  const stageScores: number[] = [];
  for (const iterations of Object.values(loopIterations)) {
    if (!iterations || iterations.length === 0) continue;
    // 取最后一轮迭代的中枢裁决分数
    const lastIter = iterations[iterations.length - 1];
    if (lastIter?.nexusVerdict?.scores) {
      stageScores.push(calcLoopQualityScore(lastIter.nexusVerdict.scores));
    }
  }

  if (stageScores.length === 0) return 50;
  const avg = stageScores.reduce((sum, s) => sum + s, 0) / stageScores.length;
  return Math.round(avg * 100) / 100;
}


// ============================================================
// 竞技模式经验提取
// ============================================================

/** 竞技模式的阶段列表（按顺序） */
const ARENA_STAGES = ['stage_plan', 'stage_char', 'stage_dir', 'stage_ep'] as const;

/** 阶段中文名映射 */
const STAGE_LABEL: Record<string, string> = {
  stage_plan: '创意方案',
  stage_char: '角色设计',
  stage_dir: '分集大纲',
  stage_ep: '剧本正文',
};

/**
 * 收集竞技会话中所有阶段的候选方案、评审和评分数据
 */
function collectArenaData(sessionId: string): {
  candidates: ArenaCandidateRow[];
  reviews: Map<string, ArenaReviewRow[]>;
  funnelScores: ArenaFunnelScoreRow[];
} {
  const candidates: ArenaCandidateRow[] = [];
  const funnelScores: ArenaFunnelScoreRow[] = [];
  const reviews = new Map<string, ArenaReviewRow[]>();

  for (const stage of ARENA_STAGES) {
    const stageCandidates = listArenaCandidatesByStage(sessionId, stage);
    candidates.push(...stageCandidates);

    const stageScores = listArenaFunnelScoresByStage(sessionId, stage);
    funnelScores.push(...stageScores);

    // 收集每个候选的评审记录
    for (const c of stageCandidates) {
      const candidateReviews = listArenaReviewsByCandidate(c.id);
      if (candidateReviews.length > 0) {
        reviews.set(c.id, candidateReviews);
      }
    }
  }

  return { candidates, reviews, funnelScores };
}

/**
 * 将竞技数据序列化为 LLM 可读的文本摘要
 * 重点对比高分和低分候选方案的差异
 */
function serializeArenaData(
  candidates: ArenaCandidateRow[],
  reviews: Map<string, ArenaReviewRow[]>,
  funnelScores: ArenaFunnelScoreRow[],
): string {
  // 按 stage 分组 funnel scores
  const scoresByStage = new Map<string, ArenaFunnelScoreRow[]>();
  for (const fs of funnelScores) {
    const list = scoresByStage.get(fs.stage) || [];
    list.push(fs);
    scoresByStage.set(fs.stage, list);
  }

  // 建立 candidate_id -> candidate 索引
  const candidateMap = new Map<string, ArenaCandidateRow>();
  for (const c of candidates) {
    candidateMap.set(c.id, c);
  }

  const parts: string[] = [];

  for (const stage of ARENA_STAGES) {
    const stageScores = scoresByStage.get(stage);
    if (!stageScores || stageScores.length === 0) continue;

    const label = STAGE_LABEL[stage] || stage;
    parts.push(`## 阶段: ${label} (共${stageScores.length}个候选方案)`);

    // 按 weighted_total 降序排列，取前3名（高分）和后3名（低分）
    const sorted = [...stageScores].sort((a, b) => b.weighted_total - a.weighted_total);
    const topN = sorted.slice(0, 3);
    const bottomN = sorted.length > 3 ? sorted.slice(-3) : [];

    // 高分方案
    parts.push('\n### 高分方案（Top 3）');
    for (const score of topN) {
      parts.push(serializeCandidateEntry(score, candidateMap, reviews));
    }

    // 低分方案
    if (bottomN.length > 0 && bottomN[0].candidate_id !== topN[topN.length - 1]?.candidate_id) {
      parts.push('\n### 低分方案（Bottom 3）');
      for (const score of bottomN) {
        parts.push(serializeCandidateEntry(score, candidateMap, reviews));
      }
    }

    parts.push('');
  }

  return parts.join('\n');
}

/**
 * 序列化单个候选方案的摘要信息（评分 + 评审意见）
 */
function serializeCandidateEntry(
  score: ArenaFunnelScoreRow,
  candidateMap: Map<string, ArenaCandidateRow>,
  reviews: Map<string, ArenaReviewRow[]>,
): string {
  const candidate = candidateMap.get(score.candidate_id);
  const agentName = candidate?.system_agent_name || '未知';
  const lines: string[] = [];

  lines.push(`- 候选 [${agentName}] 综合分: ${score.weighted_total.toFixed(2)} (排名: ${score.rank ?? '-'})`);

  // 方向评分明细
  try {
    const dirScores = JSON.parse(score.direction_scores) as Array<{ direction: string; score: number }>;
    if (dirScores.length > 0) {
      const details = dirScores.map(ds => `${ds.direction}:${ds.score}`).join(', ');
      lines.push(`  方向评分: ${details}`);
    }
  } catch { /* 解析失败则跳过 */ }

  // 评审意见摘要（限制条数避免过长）
  const candidateReviews = reviews.get(score.candidate_id);
  if (candidateReviews && candidateReviews.length > 0) {
    const topReviews = candidateReviews.slice(0, 3);
    for (const r of topReviews) {
      lines.push(`  评审[${r.direction_id}]: ${r.score}分 - ${r.comments.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}

/**
 * 构建竞技模式经验提取的 LLM Prompt
 */
function buildArenaExtractionPrompt(
  config: { genres: string[]; audience: string },
  arenaText: string,
): { system: string; user: string } {
  const system = `你是一位资深的剧本创作分析专家。你的任务是从竞技模式的评审数据中提炼出可复用的结构化经验。

竞技模式中，多个创作Agent同时创作，经过多轮评审和淘汰，最终选出最优方案。请分析高分方案和低分方案的差异，提取有价值的经验。

每条经验应属于以下四种类型之一：
- error_pattern: 低分方案的常见问题（反复出现的失败模式）
- success_pattern: 高分方案的共性特征（成功的创作策略）
- genre_rule: 题材特定的创作规律（从竞技对比中发现的题材规律）
- audience_rule: 受众相关的创作规律（从评审反馈中提炼的受众偏好）

返回 JSON 数组，每个元素格式：
{
  "type": "error_pattern" | "success_pattern" | "genre_rule" | "audience_rule",
  "genres": ["适用题材1", "适用题材2"],
  "audience": "适用受众（男频/女频/全年龄，空字符串表示通用）",
  "summary": "经验内容摘要（一段简洁的描述，50-150字）",
  "qualityIndicator": "high" | "medium" | "low"
}

要求：
1. 提取3-8条最有价值的经验，不要过多
2. summary 要具体、可操作，避免空泛的描述
3. 重点分析高分方案与低分方案的差异，提炼出可复用的规律
4. qualityIndicator 基于该经验的可靠性和普适性自评`;

  const user = `项目题材: ${config.genres.join(', ') || '未指定'}
项目受众: ${config.audience || '未指定'}

以下是该项目竞技模式的评审数据（高分方案 vs 低分方案对比）：

${arenaText}`;

  return { system, user };
}

/**
 * 基于竞技模式的 weighted_total 分数计算基础质量分数
 * 取所有阶段最高分的平均值，映射到 0-100 范围
 */
function calcArenaQualityScore(funnelScores: ArenaFunnelScoreRow[]): number {
  if (funnelScores.length === 0) return 50;

  // 按阶段分组，取每个阶段的最高 weighted_total
  const maxByStage = new Map<string, number>();
  for (const fs of funnelScores) {
    const current = maxByStage.get(fs.stage) ?? 0;
    if (fs.weighted_total > current) {
      maxByStage.set(fs.stage, fs.weighted_total);
    }
  }

  if (maxByStage.size === 0) return 50;

  // weighted_total 通常是 0-100 范围的加权分，直接取平均
  const avg = [...maxByStage.values()].reduce((sum, s) => sum + s, 0) / maxByStage.size;
  return Math.round(Math.min(100, Math.max(0, avg)) * 100) / 100;
}

/**
 * 从竞技模式项目中提取经验
 *
 * 流程：
 * 1. 读取项目数据和竞技会话
 * 2. 收集候选方案、评审记录和综合评分
 * 3. 序列化为文本，构建 LLM Prompt 分析高分/低分差异
 * 4. 调用 chatCompletionJSON 提取结构化经验
 * 5. 基于 weighted_total 计算质量分数
 * 6. 去重存储经验（复用 deduplicateAndStore）
 *
 * @param projectId 项目ID
 * @returns 提取的经验列表（空数组表示无可提取经验或提取失败）
 */
export async function extractFromArenaProject(projectId: string): Promise<ExperienceRow[]> {
  // 1. 读取项目数据
  const project = getScreenplay(projectId);
  if (!project) {
    console.log(`[experience-extractor] 项目不存在: ${projectId}`);
    return [];
  }

  // 2. 获取竞技会话
  const session = getArenaSessionByProjectId(projectId);
  if (!session) {
    console.log(`[experience-extractor] 项目无竞技会话: ${projectId}`);
    return [];
  }

  // 3. 收集竞技数据
  const { candidates, reviews, funnelScores } = collectArenaData(session.id);
  if (funnelScores.length === 0) {
    console.log(`[experience-extractor] 竞技会话无评分数据: ${projectId}`);
    return [];
  }

  // 4. 序列化竞技数据
  const arenaText = serializeArenaData(candidates, reviews, funnelScores);
  if (!arenaText.trim()) {
    console.log(`[experience-extractor] 竞技数据序列化为空: ${projectId}`);
    return [];
  }

  // 5. 计算基础质量分数（基于 weighted_total）
  const baseScore = calcArenaQualityScore(funnelScores);

  // 6. 调用 LLM 提取经验
  let extractedList: ExtractedExperience[];
  try {
    const { system, user } = buildArenaExtractionPrompt(
      { genres: project.config.genres, audience: project.config.audience },
      arenaText,
    );
    const result = await chatCompletionJSON<ExtractedExperience[]>(system, user, { timeoutMs: 120_000 });

    if (!result.success || !result.data) {
      console.error(`[experience-extractor] LLM 竞技经验提取失败: ${result.error}`);
      return [];
    }

    // 规范化为数组
    const rawData = Array.isArray(result.data) ? result.data : [result.data];
    extractedList = rawData
      .map(item => validateExtractedExperience(item))
      .filter((item): item is ExtractedExperience => item !== null);
  } catch (err) {
    console.error(`[experience-extractor] LLM 竞技经验提取异常:`, err);
    return [];
  }

  if (extractedList.length === 0) {
    console.log(`[experience-extractor] LLM 未返回有效竞技经验: ${projectId}`);
    return [];
  }

  // 7. 构建 ExperienceRow 列表
  const now = Date.now();
  const experiences: ExperienceRow[] = extractedList.map(ext => ({
    id: crypto.randomUUID(),
    type: ext.type,
    genres: JSON.stringify(ext.genres),
    audience: ext.audience,
    summary: ext.summary,
    source_project_id: projectId,
    source_mode: 'arena' as const,
    quality_score: applyQualityIndicator(baseScore, ext.qualityIndicator),
    reference_count: 0,
    created_at: now,
    updated_at: now,
  }));

  // 8. 去重存储（复用 deduplicateAndStore）
  const existingExperiences = listExperiencesBySourceProject(projectId);
  deduplicateAndStore(experiences, existingExperiences);

  console.log(`[experience-extractor] 竞技项目 ${projectId} 提取了 ${experiences.length} 条经验`);
  return experiences;
}


// ============================================================
// 统一提取入口
// ============================================================

/**
 * 统一经验提取入口 - 自动判断项目模式并调用对应的提取函数
 *
 * 判断逻辑：
 * 1. 优先检查 config.arenaMode 字段
 * 2. 其次检查是否存在竞技会话（getArenaSessionByProjectId）
 * 3. 默认按闭环模式处理
 *
 * 降级策略（Requirements 1.5）：
 * - LLM 调用失败时记录错误日志，返回已成功提取的部分结果
 * - 项目不存在时返回空数组，不抛出异常
 *
 * @param projectId 项目ID
 * @returns 提取的经验列表
 */
export async function extractExperiences(projectId: string): Promise<ExperienceRow[]> {
  // 1. 读取项目数据
  const project = getScreenplay(projectId);
  if (!project) {
    console.log(`[experience-extractor] 项目不存在，跳过提取: ${projectId}`);
    return [];
  }

  // 2. 判断项目模式
  const isArena = project.config.arenaMode === true
    || getArenaSessionByProjectId(projectId) !== null;

  const mode = isArena ? 'arena' : 'loop';
  console.log(`[experience-extractor] 项目 ${projectId} 检测为 ${mode} 模式，开始提取经验`);

  // 3. 调用对应的提取函数，包裹 try-catch 实现降级处理
  try {
    const experiences = isArena
      ? await extractFromArenaProject(projectId)
      : await extractFromLoopProject(projectId);

    console.log(`[experience-extractor] 项目 ${projectId} 提取完成，共 ${experiences.length} 条经验`);
    return experiences;
  } catch (err) {
    // 降级处理：记录错误日志，返回空数组（部分结果已在子函数中存储）
    console.error(`[experience-extractor] 项目 ${projectId} 经验提取异常，降级返回空结果:`, err);
    return [];
  }
}
