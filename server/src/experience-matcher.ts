// 经验匹配器 - 根据项目配置从经验库中检索和排序相关经验
// 匹配维度：题材(genres)、受众(audience)，支持质量阈值过滤和高引用降级

import { listExperiences, type ExperienceRow, type MatchOptions } from './experience-store.js';
import type { ScreenplayConfig } from './screenplay-creator.js';

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_MIN_SCORE = 40;
const DEFAULT_MAX_REFERENCE_COUNT = 50;
const DEFAULT_LIMIT = 20;

// 相关性分数权重
const SCORE_GENRE_EXACT = 100;   // 题材完全匹配
const SCORE_GENRE_PARTIAL = 60;  // 题材部分匹配
const SCORE_AUDIENCE = 30;       // 受众匹配
const SCORE_UNIVERSAL = 10;      // 通用经验（无特定题材/受众限制）

// 高引用降级系数
const HIGH_REF_PENALTY = 0.5;

// ============================================================
// 辅助函数
// ============================================================

/** 安全解析经验的 genres JSON 字符串为数组 */
function parseGenres(genresStr: string): string[] {
  try {
    const parsed = JSON.parse(genresStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 判断经验是否为通用经验（无特定题材和受众限制） */
function isUniversal(expGenres: string[], expAudience: string): boolean {
  return expGenres.length === 0 && (!expAudience || expAudience === '');
}

/**
 * 计算单条经验与项目配置的相关性分数
 * 规则：
 *   - 题材完全匹配（经验genres ⊆ 项目genres 且非空）：+100
 *   - 题材部分匹配（genres有交集）：+60
 *   - 受众匹配：+30
 *   - 通用经验（无特定题材/受众）：+10
 */
export function calcRelevanceScore(
  expGenres: string[],
  expAudience: string,
  configGenres: string[],
  configAudience: string,
): number {
  let score = 0;

  // 题材匹配
  if (expGenres.length > 0 && configGenres.length > 0) {
    const intersection = expGenres.filter(g => configGenres.includes(g));
    if (intersection.length === expGenres.length) {
      // 经验的所有题材都在项目题材中 → 完全匹配
      score += SCORE_GENRE_EXACT;
    } else if (intersection.length > 0) {
      // 有交集但不完全 → 部分匹配
      score += SCORE_GENRE_PARTIAL;
    }
  }

  // 受众匹配
  if (expAudience && configAudience && expAudience === configAudience) {
    score += SCORE_AUDIENCE;
  }

  // 通用经验兜底
  if (isUniversal(expGenres, expAudience)) {
    score += SCORE_UNIVERSAL;
  }

  return score;
}

// ============================================================
// 核心匹配函数
// ============================================================

/**
 * 根据项目配置匹配经验
 * 1. 查询质量分数 >= minScore 的经验
 * 2. 计算每条经验的相关性分数
 * 3. 高引用经验降级（reference_count > maxReferenceCount → 相关性 × 0.5）
 * 4. 按相关性分数降序，同分按质量分数降序排列
 * 5. 返回前 limit 条结果
 */
export function matchExperiences(
  config: ScreenplayConfig,
  options?: MatchOptions,
): ExperienceRow[] {
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const maxRefCount = options?.maxReferenceCount ?? DEFAULT_MAX_REFERENCE_COUNT;
  const limit = options?.limit ?? DEFAULT_LIMIT;

  // 1. 查询满足质量阈值的经验
  const candidates = listExperiences({ minScore });

  // 2. 计算相关性分数并附加到排序用的临时结构
  const scored = candidates.map(exp => {
    const expGenres = parseGenres(exp.genres);
    let relevance = calcRelevanceScore(
      expGenres,
      exp.audience,
      config.genres,
      config.audience,
    );

    // 3. 高引用降级
    if (exp.reference_count > maxRefCount) {
      relevance = relevance * HIGH_REF_PENALTY;
    }

    return { exp, relevance };
  });

  // 4. 排序：相关性降序，同分按质量分数降序
  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return b.exp.quality_score - a.exp.quality_score;
  });

  // 5. 截取前 limit 条
  return scored.slice(0, limit).map(s => s.exp);
}
