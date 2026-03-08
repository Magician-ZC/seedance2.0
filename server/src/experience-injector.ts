// 经验注入器 - 将匹配到的经验格式化并注入到Agent的context中
// 按 targetAgent 路由经验类型，控制 token 预算，格式化为编号列表

import type { ExperienceRow, ExperienceType } from './experience-store.js';
import { incrementReferenceCount } from './experience-store.js';
import { matchExperiences } from './experience-matcher.js';
import type { ScreenplayConfig } from './screenplay-creator.js';
import type { LoopConfig } from './creation-loop.js';

// ============================================================
// 常量配置
// ============================================================

/** 中文 token 估算系数：约1.5字符/token */
const CHARS_PER_TOKEN = 1.5;

/** 默认 token 预算 */
const DEFAULT_TOKEN_BUDGET = 2000;

/** 经验类型的中文标签映射 */
const TYPE_LABELS: Record<ExperienceType, string> = {
  error_pattern: '错误模式',
  success_pattern: '成功模式',
  genre_rule: '题材规律',
  audience_rule: '受众规律',
};

/** 各 Agent 接收的经验类型 */
const AGENT_TYPE_MAP: Record<'mentor' | 'humanity', ExperienceType[]> = {
  mentor: ['error_pattern', 'genre_rule'],
  humanity: ['success_pattern', 'audience_rule'],
};

// ============================================================
// 辅助函数
// ============================================================

/** 估算文本的 token 数（中文约1.5字符/token） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 格式化单条经验为编号列表项 */
function formatExperienceItem(index: number, exp: ExperienceRow): string {
  const label = TYPE_LABELS[exp.type] || exp.type;
  return `${index}. [${label}] ${exp.summary}`;
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 构建经验注入文本
 *
 * 按 targetAgent 过滤经验类型，格式化为编号列表，控制在 token 预算内。
 * - mentor: 接收 error_pattern + genre_rule
 * - humanity: 接收 success_pattern + audience_rule
 *
 * @param experiences 匹配到的经验列表（已按优先级排序）
 * @param targetAgent 目标Agent类型
 * @param tokenBudget token预算上限
 * @returns 格式化后的注入文本，空则返回空字符串
 */
export function buildInjectionContext(
  experiences: ExperienceRow[],
  targetAgent: 'mentor' | 'humanity',
  tokenBudget: number,
): string {
  // token 预算校验：0或负数使用默认值
  const budget = tokenBudget > 0 ? tokenBudget : DEFAULT_TOKEN_BUDGET;

  // 按 targetAgent 过滤经验类型
  const allowedTypes = AGENT_TYPE_MAP[targetAgent];
  const filtered = experiences.filter(exp => allowedTypes.includes(exp.type));

  if (filtered.length === 0) return '';

  // 逐条添加，累计 token 不超过预算
  const lines: string[] = [];
  let totalTokens = 0;
  let itemIndex = 1;

  for (const exp of filtered) {
    const line = formatExperienceItem(itemIndex, exp);
    const lineTokens = estimateTokens(line);

    // 加上换行符的 token 开销
    const newlineTokens = lines.length > 0 ? estimateTokens('\n') : 0;
    const costTokens = lineTokens + newlineTokens;

    if (totalTokens + costTokens > budget) break;

    lines.push(line);
    totalTokens += costTokens;
    itemIndex++;
  }

  return lines.join('\n');
}

// ============================================================
// 内部辅助：匹配 + 构建注入文本 + 递增引用计数
// ============================================================

/**
 * 匹配经验并构建 mentor / humanity 两路注入文本
 * 注入成功后递增被引用经验的 reference_count
 */
function matchAndBuild(
  config: ScreenplayConfig,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): { mentorContext: string; humanityContext: string; injectedIds: string[] } {
  const experiences = matchExperiences(config);

  const mentorContext = buildInjectionContext(experiences, 'mentor', tokenBudget);
  const humanityContext = buildInjectionContext(experiences, 'humanity', tokenBudget);

  // 收集实际被注入的经验 ID（mentor 或 humanity 文本中包含其 summary 的经验）
  const mentorTypes = AGENT_TYPE_MAP.mentor;
  const humanityTypes = AGENT_TYPE_MAP.humanity;
  const injectedIds: string[] = [];

  for (const exp of experiences) {
    const isMentorType = mentorTypes.includes(exp.type);
    const isHumanityType = humanityTypes.includes(exp.type);

    if ((isMentorType && mentorContext.includes(exp.summary)) ||
        (isHumanityType && humanityContext.includes(exp.summary))) {
      injectedIds.push(exp.id);
    }
  }

  // 递增被引用经验的引用计数
  for (const id of injectedIds) {
    incrementReferenceCount(id);
  }

  return { mentorContext, humanityContext, injectedIds };
}

// ============================================================
// 公开注入函数
// ============================================================

/**
 * 为闭环模式注入经验
 *
 * 根据 ScreenplayConfig 匹配历史经验，将 mentor 类经验注入 mentorContext，
 * humanity 类经验注入 humanityContext，返回增强后的 LoopConfig。
 *
 * @param config 项目配置（用于经验匹配）
 * @param loopConfig 原始闭环配置
 * @returns 填充了 mentorContext / humanityContext 的增强 LoopConfig
 */
export function injectForLoopMode(
  config: ScreenplayConfig,
  loopConfig: Partial<LoopConfig>,
): Partial<LoopConfig> {
  const { mentorContext, humanityContext } = matchAndBuild(config);

  // 将经验文本追加到已有 context（如有），用换行分隔
  const mergedMentor = [loopConfig.mentorContext, mentorContext].filter(Boolean).join('\n');
  const mergedHumanity = [loopConfig.humanityContext, humanityContext].filter(Boolean).join('\n');

  return {
    ...loopConfig,
    ...(mergedMentor ? { mentorContext: mergedMentor } : {}),
    ...(mergedHumanity ? { humanityContext: mergedHumanity } : {}),
  };
}

/**
 * 为竞技模式注入经验
 *
 * 根据 ScreenplayConfig 匹配历史经验，返回 mentorContext / humanityContext 对象，
 * 供竞技引擎合并到 arenaLoopRefine 的闭环配置中。
 *
 * @param config 项目配置（用于经验匹配）
 * @returns 包含 mentorContext 和 humanityContext 的对象
 */
export function injectForArenaMode(
  config: ScreenplayConfig,
): { mentorContext?: string; humanityContext?: string } {
  const { mentorContext, humanityContext } = matchAndBuild(config);

  const result: { mentorContext?: string; humanityContext?: string } = {};
  if (mentorContext) result.mentorContext = mentorContext;
  if (humanityContext) result.humanityContext = humanityContext;
  return result;
}

