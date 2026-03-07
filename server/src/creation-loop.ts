/**
 * creation-loop.ts — 三位一体+中枢迭代 闭环创作引擎
 *
 * 架构：
 *   导师Agent（行业专家）+ 人性Agent（爆款制作人）+ 中枢控制器
 *   创作Agent 产出初稿 → 导师+人性 交叉审阅 → 中枢汇总+冲突裁决 → 创作Agent 迭代修改
 *
 * 反馈格式规范：[位置] + [问题原因] + [修改建议]
 * 量化验收：逻辑真实度 ≥ 90, 情绪爽感值 ≥ 95, 对白风格化 ≥ 85
 */

import { chatCompletionJSON, chatCompletion, selectConfig, enhancePromptForNSFW, type TaskType, type LLMConfig } from './llm-service.js';
import { logLLMCall } from './db-service.js';
import type { ScreenplayConfig, CreativePlan, CharacterDesign, EpisodeScript, EpisodeDirectoryItem, StageModelKey } from './screenplay-creator.js';
import { getScreenplay, updateScreenplay } from './screenplay-creator.js';

// ============================================================
// 类型定义
// ============================================================

/** 反馈条目：严格遵循 [位置]+[问题原因]+[修改建议] 格式 */
export interface FeedbackItem {
  location: string;      // 位置（如"第3幕"、"角色C02的动机"、"第5集结尾"）
  issue: string;         // 问题原因
  suggestion: string;    // 修改建议
  severity: 'critical' | 'major' | 'minor';  // 严重程度
}

/** Agent审阅结果 */
export interface AgentReview {
  agentType: 'mentor' | 'humanity';
  score: number;         // 0-100
  feedbacks: FeedbackItem[];
  summary: string;       // 一句话总评
}

/** 中枢裁决结果 */
export interface NexusVerdict {
  mergedFeedbacks: FeedbackItem[];   // 合并去重后的反馈
  conflictResolutions: string[];     // 冲突裁决说明
  priorityActions: string[];         // 优先修改项（按重要性排序）
  passThreshold: boolean;            // 是否达标
  scores: LoopScores;
}

/** 量化验收分数 */
export interface LoopScores {
  logicTruth: number;       // 逻辑真实度（导师Agent评，目标≥90）
  emotionHook: number;      // 情绪爽感值（人性Agent评，目标≥95）
  dialogueStyle: number;    // 对白风格化（创作Agent自评，目标≥85）
}

/** 闭环迭代记录 */
export interface LoopIteration {
  version: string;           // V1.0, V2.0, ...
  mentorReview: AgentReview;
  humanityReview: AgentReview;
  nexusVerdict: NexusVerdict;
  timestamp: number;
}

/** 闭环创作配置 */
export interface LoopConfig {
  maxIterations: number;     // 最大迭代次数（防止无限循环），默认3
  mentorContext?: string;    // 导师Agent额外注入的行业知识
  humanityContext?: string;  // 人性Agent额外注入的爆款基因
  thresholds: Partial<LoopScores>;   // 验收阈值（缺省字段使用默认值）
}

/** 闭环创作结果 */
export interface LoopResult<T> {
  finalOutput: T;
  iterations: LoopIteration[];
  totalIterations: number;
  passed: boolean;
  finalScores: LoopScores;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterations: 3,
  thresholds: { logicTruth: 90, emotionHook: 95, dialogueStyle: 85 },
};

// ============================================================
// LLM 调用封装（复用项目已有模式）
// ============================================================

function getProjectNsfw(projectId: string): boolean {
  return getScreenplay(projectId)?.config?.nsfw || false;
}

function getProjectFixedModel(projectId: string) {
  return getScreenplay(projectId)?.config?.fixedModel;
}

/** 根据阶段key获取指定模型 */
function getStageModel(projectId: string, stageKey?: StageModelKey): LLMConfig | undefined {
  if (!stageKey) return undefined;
  const mapped = getScreenplay(projectId)?.config?.stageModelMap?.[stageKey];
  return mapped?.apiKey ? mapped : undefined;
}

async function loopLLMJSON<T>(
  projectId: string, step: string, system: string, user: string, taskType: TaskType = 'evaluate', stageKey?: StageModelKey
): Promise<{ success: boolean; data?: T; error?: string; raw?: string }> {
  const nsfw = getProjectNsfw(projectId);
  const stageModel = getStageModel(projectId, stageKey);
  const config = stageModel || selectConfig(taskType, getProjectFixedModel(projectId), nsfw);
  const finalSystem = enhancePromptForNSFW(system, nsfw);
  const startTime = Date.now();
  const result = await chatCompletionJSON<T>(finalSystem, user, { config, timeoutMs: 600000 });
  logLLMCall({
    projectId, step, provider: config.provider, model: config.model,
    durationMs: Date.now() - startTime, success: result.success, error: result.error,
    promptText: finalSystem + '\n---USER---\n' + user,
    responseText: result.raw || (result.error ? `[ERROR] ${result.error}` : ''),
  });
  return result;
}


// ============================================================
// 导师Agent — 行业专家视角
// ============================================================

function buildMentorSystemPrompt(config: ScreenplayConfig, extraContext?: string): string {
  const genreContext = config.genres.join('、');
  return `## Role
你是短剧创作系统的"导师Agent（专业逻辑官）"。你是各行业的百科全书，负责为剧本提供严谨的背景支撑和逻辑校准。
当前题材：${genreContext}

## Task
1. 知识注入：根据题材提供行业黑话、法律常识或职场规则。
2. 逻辑体检：审视剧本中的因果关系。禁止出现"降智"剧情，除非该剧情是刻意设计的铺垫。
3. 事实核查：检查剧情涉及的常识（如医疗操作、商业合同、历史背景）是否有误。
${extraContext ? `\n## 额外行业知识\n${extraContext}` : ''}

## Review Criteria（审阅阶段）
- 颗粒度：必须指出具体到哪一场戏、哪一句台词。
- 修改策略：不仅要说哪里错，必须给出合乎逻辑的替代方案。
- 语气：严谨、理性、客观。

## 反馈格式要求（严格遵循）
每条反馈必须包含三个要素：
- location: 具体位置（如"第3幕第2场"、"角色C02的动机设定"、某句台词）
- issue: 问题原因（为什么这是个问题）
- suggestion: 具体修改建议（可执行的改进方案）

## 评分标准
- logicTruth（逻辑真实度）：0-100分
  - 90-100：逻辑严密，无硬伤
  - 70-89：有小瑕疵但不影响主线
  - 50-69：有明显逻辑漏洞
  - <50：逻辑混乱，需要重写

请严格按JSON格式输出审阅结果。`;
}

// ============================================================
// 人性Agent — 爆款制作人视角
// ============================================================

function buildHumanitySystemPrompt(config: ScreenplayConfig, extraContext?: string): string {
  const audienceLabel = config.audience === '男频' ? '男性用户' : config.audience === '女频' ? '女性用户' : '全年龄用户';
  return `## Role
你是短剧创作系统的"人性Agent（心理策略师）"。你深谙大众心理学，负责通过操控观众的愤怒、焦虑、同情和报复欲来提升剧本的粘性。

## Psychology Framework
- 人性弱点：损失厌恶、社会比较（攀比）、归属感渴求、复仇快感。
- 爽点模型：压抑后的极致释放、身份反转、降维打击、打脸反馈。

## Task
1. 钩子设计：确保前3秒必有冲突，前30秒必有反转。
2. 情绪曲线：审视剧本的情绪密度，确保"憋屈（铺垫）"与"爽点（释放）"的比例合理。
3. 代入感：确保主角的动机能引发观众的强烈共鸣。

## 目标受众：${audienceLabel}
${config.audience === '男频' ? '- 核心爽点：身份碾压、实力打脸、美女倒贴、装逼打脸\n- 核心痛点：被看不起、被背叛、被欺负' : ''}
${config.audience === '女频' ? '- 核心爽点：逆袭翻盘、渣男受罚、真爱守护、身份揭露\n- 核心痛点：被抛弃、被替代、被误解、被辜负' : ''}
${extraContext ? `\n## 爆款基因知识库\n${extraContext}` : ''}

## Review Format（审阅阶段）
每条反馈必须包含三个要素：
- location: 具体位置
- issue: 情绪预警——指出剧情平淡乏味的位置（从人性心理学角度分析）
- suggestion: 增强建议——[增加憋屈感的方法] 或 [加强反击力度的方法]

## 评分标准
- emotionHook（情绪爽感值）：0-100分
  - 95-100：每一秒都在制造情绪，观众根本停不下来
  - 80-94：整体不错但有几处情绪断档
  - 60-79：爽点不够密集，观众可能划走
  - <60：平淡无奇，毫无吸引力

请严格按JSON格式输出审阅结果。`;
}

// ============================================================
// 审阅JSON格式指令
// ============================================================

const REVIEW_JSON_FORMAT = `

请严格按以下JSON格式输出，不要输出任何其他内容：
{
  "score": <0-100的整数>,
  "summary": "一句话总评",
  "feedbacks": [
    {
      "location": "具体位置",
      "issue": "问题原因",
      "suggestion": "修改建议",
      "severity": "critical|major|minor"
    }
  ]
}`;


// ============================================================
// 中枢控制器 — 汇总意见、裁决冲突、生成修改清单
// ============================================================

const NEXUS_SYSTEM_PROMPT = `## Role
你是短剧创作系统的"控制中枢（首席制片人）"。你负责统筹导师Agent、人性Agent和创作Agent，确保产出的剧本既有专业逻辑，又能精准打击用户情绪。

## Workflow Logic
1. 初步整合：将导师和人性Agent的研究成果进行汇总分析。
2. 闭环审阅：收集两者对当前版本的结构化修改意见。
3. 冲突决策：若导师（逻辑）与人性（爽感）产生冲突，你必须做出最终裁定。
   - 原则：小逻辑服从大爽感，但不能产生常识性硬伤。
   - 如果逻辑硬伤会导致观众出戏 → 优先修复逻辑
   - 如果逻辑瑕疵不影响观感 → 牺牲部分逻辑保证爽感
   - 最佳方案是"合理的爽"——用巧妙的逻辑支撑爽点
4. 迭代指令：将汇总后的意见转化为具体的修改指令。
5. 验收判定：根据两位Agent的评分判断是否达标。

## Output Format（意见汇总阶段）
- 当前版本评分：逻辑分数/爽感分数
- 修改需求清单：[位置] + [修改原因] + [具体修改方向]
- 迭代状态：[继续迭代/准予发布]

请严格按JSON格式输出裁决结果。`;

const NEXUS_JSON_FORMAT = `

请严格按以下JSON格式输出：
{
  "mergedFeedbacks": [
    {
      "location": "位置",
      "issue": "问题原因",
      "suggestion": "修改建议",
      "severity": "critical|major|minor"
    }
  ],
  "conflictResolutions": ["冲突裁决说明1", "冲突裁决说明2"],
  "priorityActions": ["优先修改项1", "优先修改项2"],
  "passThreshold": true/false,
  "scores": {
    "logicTruth": <导师Agent评分>,
    "emotionHook": <人性Agent评分>,
    "dialogueStyle": <综合评估对白风格化分数0-100>
  }
}`;

// ============================================================
// 核心闭环函数：单步审阅
// ============================================================

/** 执行导师Agent审阅 */
async function mentorReview(
  projectId: string,
  content: string,
  config: ScreenplayConfig,
  loopConfig: LoopConfig,
  step: string,
): Promise<AgentReview> {
  const systemPrompt = buildMentorSystemPrompt(config, loopConfig.mentorContext) + REVIEW_JSON_FORMAT;
  const result = await loopLLMJSON<{ score: number; summary: string; feedbacks: FeedbackItem[] }>(
    projectId, `loop_mentor_${step}`, systemPrompt, content, 'evaluate', 'loop_mentor'
  );

  if (!result.success || !result.data) {
    return { agentType: 'mentor', score: 0, feedbacks: [], summary: '导师Agent审阅失败' };
  }

  return {
    agentType: 'mentor',
    score: Math.max(0, Math.min(100, result.data.score || 0)),
    feedbacks: (result.data.feedbacks || []).map(f => ({
      location: f.location || '未指定',
      issue: f.issue || '',
      suggestion: f.suggestion || '',
      severity: (['critical', 'major', 'minor'].includes(f.severity) ? f.severity : 'minor') as FeedbackItem['severity'],
    })),
    summary: result.data.summary || '',
  };
}

/** 执行人性Agent审阅 */
async function humanityReview(
  projectId: string,
  content: string,
  config: ScreenplayConfig,
  loopConfig: LoopConfig,
  step: string,
): Promise<AgentReview> {
  const systemPrompt = buildHumanitySystemPrompt(config, loopConfig.humanityContext) + REVIEW_JSON_FORMAT;
  const result = await loopLLMJSON<{ score: number; summary: string; feedbacks: FeedbackItem[] }>(
    projectId, `loop_humanity_${step}`, systemPrompt, content, 'evaluate', 'loop_humanity'
  );

  if (!result.success || !result.data) {
    return { agentType: 'humanity', score: 0, feedbacks: [], summary: '人性Agent审阅失败' };
  }

  return {
    agentType: 'humanity',
    score: Math.max(0, Math.min(100, result.data.score || 0)),
    feedbacks: (result.data.feedbacks || []).map(f => ({
      location: f.location || '未指定',
      issue: f.issue || '',
      suggestion: f.suggestion || '',
      severity: (['critical', 'major', 'minor'].includes(f.severity) ? f.severity : 'minor') as FeedbackItem['severity'],
    })),
    summary: result.data.summary || '',
  };
}

/** 中枢裁决：汇总两位Agent意见 */
async function nexusJudge(
  projectId: string,
  mentorResult: AgentReview,
  humanityResult: AgentReview,
  thresholds: Partial<LoopScores>,
  step: string,
): Promise<NexusVerdict> {
  // 填充默认阈值
  const t = {
    logicTruth: thresholds.logicTruth ?? 90,
    emotionHook: thresholds.emotionHook ?? 95,
    dialogueStyle: thresholds.dialogueStyle ?? 85,
  };

  const userPrompt = `## 导师Agent审阅结果
评分：${mentorResult.score}/100
总评：${mentorResult.summary}
反馈条目：
${mentorResult.feedbacks.map((f, i) => `${i + 1}. [${f.severity}][${f.location}] ${f.issue} → ${f.suggestion}`).join('\n')}

## 人性Agent审阅结果
评分：${humanityResult.score}/100
总评：${humanityResult.summary}
反馈条目：
${humanityResult.feedbacks.map((f, i) => `${i + 1}. [${f.severity}][${f.location}] ${f.issue} → ${f.suggestion}`).join('\n')}

## 验收阈值
- 逻辑真实度 ≥ ${t.logicTruth}
- 情绪爽感值 ≥ ${t.emotionHook}
- 对白风格化 ≥ ${t.dialogueStyle}

请汇总意见、裁决冲突、判断是否达标。`;

  const result = await loopLLMJSON<NexusVerdict>(
    projectId, `loop_nexus_${step}`, NEXUS_SYSTEM_PROMPT + NEXUS_JSON_FORMAT, userPrompt, 'evaluate', 'loop_nexus'
  );

  if (!result.success || !result.data) {
    // 降级：直接合并反馈，不做冲突裁决
    const allFeedbacks = [...mentorResult.feedbacks, ...humanityResult.feedbacks];
    const scores: LoopScores = {
      logicTruth: mentorResult.score,
      emotionHook: humanityResult.score,
      dialogueStyle: Math.round((mentorResult.score + humanityResult.score) / 2),
    };
    return {
      mergedFeedbacks: allFeedbacks,
      conflictResolutions: ['中枢裁决失败，直接合并所有反馈'],
      priorityActions: allFeedbacks.filter(f => f.severity === 'critical').map(f => f.suggestion),
      passThreshold: scores.logicTruth >= t.logicTruth
        && scores.emotionHook >= t.emotionHook
        && scores.dialogueStyle >= t.dialogueStyle,
      scores,
    };
  }

  const data = result.data;
  // 确保scores使用实际Agent评分
  const scores: LoopScores = {
    logicTruth: data.scores?.logicTruth ?? mentorResult.score,
    emotionHook: data.scores?.emotionHook ?? humanityResult.score,
    dialogueStyle: data.scores?.dialogueStyle ?? 0,
  };

  return {
    mergedFeedbacks: data.mergedFeedbacks || [],
    conflictResolutions: data.conflictResolutions || [],
    priorityActions: data.priorityActions || [],
    passThreshold: data.passThreshold ?? (
      scores.logicTruth >= t.logicTruth
      && scores.emotionHook >= t.emotionHook
      && scores.dialogueStyle >= t.dialogueStyle
    ),
    scores,
  };
}


// ============================================================
// 迭代修改指令生成
// ============================================================

function buildRevisionPrompt(verdict: NexusVerdict): string {
  const feedbackList = verdict.mergedFeedbacks
    .map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}][${f.location}]\n   问题：${f.issue}\n   建议：${f.suggestion}`)
    .join('\n\n');

  const conflictNotes = verdict.conflictResolutions.length > 0
    ? `\n## 冲突裁决说明（请遵循）\n${verdict.conflictResolutions.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : '';

  const priorities = verdict.priorityActions.length > 0
    ? `\n## 优先修改项（必须处理）\n${verdict.priorityActions.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';

  return `## 修改清单（基于导师Agent和人性Agent的交叉审阅）

当前评分：
- 逻辑真实度：${verdict.scores.logicTruth}/100
- 情绪爽感值：${verdict.scores.emotionHook}/100
- 对白风格化：${verdict.scores.dialogueStyle}/100
${priorities}
${conflictNotes}

## 详细反馈
${feedbackList}

## 修改原则
1. 只修改反馈中指出的问题，保留原内容的优点
2. critical级别的问题必须修复
3. 当逻辑和爽感冲突时，遵循冲突裁决说明
4. 修改后的内容不能缩水，只能增强`;
}

// ============================================================
// 通用闭环迭代器
// ============================================================

/**
 * 通用闭环创作迭代器
 * @param projectId 项目ID
 * @param stepName 步骤名称（用于日志和进度推送）
 * @param initialContent 初始内容（V1.0）
 * @param contentSerializer 将内容序列化为审阅用文本
 * @param revise 修改函数：接收当前内容+修改清单，返回新版本
 * @param loopConfig 闭环配置
 * @param onProgress 进度回调
 */
export async function runCreationLoop<T>(
  projectId: string,
  stepName: string,
  initialContent: T,
  contentSerializer: (content: T) => string,
  revise: (current: T, revisionPrompt: string, version: string) => Promise<T | null>,
  loopConfig: Partial<LoopConfig> = {},
  onProgress?: (msg: string) => void,
): Promise<LoopResult<T>> {
  const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, ...loopConfig, thresholds: { ...DEFAULT_LOOP_CONFIG.thresholds, ...loopConfig.thresholds } };
  const project = getScreenplay(projectId);
  if (!project) throw new Error('项目不存在');

  const iterations: LoopIteration[] = [];
  let currentContent = initialContent;
  let passed = false;
  let finalScores: LoopScores = { logicTruth: 0, emotionHook: 0, dialogueStyle: 0 };

  for (let i = 0; i < config.maxIterations; i++) {
    const version = `V${i + 1}.0`;
    const iterStep = `${stepName}_iter${i + 1}`;

    onProgress?.(`🔄 闭环迭代 ${version}：导师Agent + 人性Agent 交叉审阅中...`);

    // 序列化当前内容
    const contentText = contentSerializer(currentContent);

    // 并行执行导师Agent和人性Agent审阅
    const [mentorResult, humanityResult] = await Promise.all([
      mentorReview(projectId, contentText, project.config, config, iterStep),
      humanityReview(projectId, contentText, project.config, config, iterStep),
    ]);

    onProgress?.(`📊 ${version} 审阅完成 — 逻辑:${mentorResult.score} 爽感:${humanityResult.score}`);

    // 中枢裁决
    onProgress?.(`🧠 中枢控制器汇总意见、裁决冲突...`);
    const verdict = await nexusJudge(projectId, mentorResult, humanityResult, config.thresholds, iterStep);

    // 记录迭代
    iterations.push({
      version,
      mentorReview: mentorResult,
      humanityReview: humanityResult,
      nexusVerdict: verdict,
      timestamp: Date.now(),
    });

    finalScores = verdict.scores;

    // 检查是否达标
    if (verdict.passThreshold) {
      onProgress?.(`✅ ${version} 达标！逻辑:${verdict.scores.logicTruth} 爽感:${verdict.scores.emotionHook} 对白:${verdict.scores.dialogueStyle}`);
      passed = true;
      break;
    }

    // 未达标且还有迭代次数 → 生成修改清单并迭代
    if (i < config.maxIterations - 1) {
      const revisionPrompt = buildRevisionPrompt(verdict);
      onProgress?.(`📝 ${version} 未达标，生成修改清单（${verdict.mergedFeedbacks.length}条反馈），开始迭代...`);

      const revised = await revise(currentContent, revisionPrompt, `V${i + 2}.0`);
      if (revised) {
        currentContent = revised;
      } else {
        onProgress?.(`⚠️ 迭代修改失败，保留 ${version}`);
        break;
      }
    } else {
      onProgress?.(`⏹️ 已达最大迭代次数(${config.maxIterations})，使用最终版本`);
    }
  }

  return {
    finalOutput: currentContent,
    iterations,
    totalIterations: iterations.length,
    passed,
    finalScores,
  };
}


// ============================================================
// 创作方案闭环
// ============================================================

/** 将CreativePlan序列化为审阅文本 */
function serializeCreativePlan(plan: CreativePlan): string {
  const acts = plan.fourActs || (plan as any).threeActs;
  return `【创作方案审阅】

剧名备选：${plan.titleOptions.map(t => `${t.title}（${t.description}）`).join('、')}

时空背景：${plan.setting.era}，${plan.setting.location}，${plan.setting.socialEnv}，阶层关系：${plan.setting.classRelation}

故事线：${plan.storyLine}
核心冲突：${plan.coreConflict}

四幕结构：
第一幕·起(${acts?.act1?.episodeRange})：${acts?.act1?.coreEvents?.join('、')}
第二幕·承(${acts?.act2?.episodeRange})：${acts?.act2?.conflicts?.join('、')}
第三幕·转(${acts?.act3?.episodeRange})：${acts?.act3?.climax}
第四幕·合(${acts?.act4?.episodeRange})：${acts?.act4?.ending}

节奏波形：${plan.rhythmWave}
付费卡点：${plan.paywallPlan?.map(p => `第${p.episode}集(${p.type})`).join('、')}
爽点矩阵：${JSON.stringify(plan.satisfactionMatrix)}
结局设计：主线-${plan.endingDesign?.mainLine}，感情线-${plan.endingDesign?.romanceLine}`;
}

/** 对创作方案执行闭环迭代 */
export async function loopCreativePlan(
  projectId: string,
  initialPlan: CreativePlan,
  loopConfig?: Partial<LoopConfig>,
  onProgress?: (msg: string) => void,
): Promise<LoopResult<CreativePlan>> {
  const project = getScreenplay(projectId);
  if (!project) throw new Error('项目不存在');

  return runCreationLoop<CreativePlan>(
    projectId,
    'creative_plan',
    initialPlan,
    serializeCreativePlan,
    async (current, revisionPrompt, version) => {
      const systemPrompt = `你是一位专业的微短剧编剧。请根据修改清单优化创作方案。
保留原方案的优点，只修改反馈中指出的问题。
输出完整的优化后创作方案，严格JSON格式。`;

      const userPrompt = `当前创作方案（${version}前版本）：
${JSON.stringify(current, null, 2)}

${revisionPrompt}

请输出优化后的完整创作方案，JSON格式与原方案一致。`;

      const result = await loopLLMJSON<CreativePlan>(projectId, `loop_revise_plan_${version}`, systemPrompt, userPrompt, 'optimize', 'loop_revise');
      return result.success && result.data ? result.data : null;
    },
    loopConfig,
    onProgress,
  );
}

// ============================================================
// 角色设计闭环
// ============================================================

function serializeCharacterDesign(design: CharacterDesign): string {
  const chars = design.characters.map(c =>
    `${c.id} ${c.name}（${c.publicIdentity}→${c.realIdentity}）：性格${c.personality.join('/')}，动机：${c.motivation}，冲突点：${c.conflictPoint}，爽点功能：${c.satisfactionRole}，口头禅："${c.catchphrase}"，弧线：${c.arc}`
  ).join('\n');

  const rels = design.relationships?.map(r => `${r.from} → ${r.to}：${r.relation}`).join('\n') || '';

  return `【角色体系审阅】

角色列表：
${chars}

人物关系：
${rels}

感情线：${design.romanceLine?.map(r => `第${r.episode}集：${r.event}`).join('、') || '无'}

反派体系：${JSON.stringify(design.villainSystem)}`;
}

export async function loopCharacterDesign(
  projectId: string,
  initialDesign: CharacterDesign,
  loopConfig?: Partial<LoopConfig>,
  onProgress?: (msg: string) => void,
): Promise<LoopResult<CharacterDesign>> {
  return runCreationLoop<CharacterDesign>(
    projectId,
    'character_design',
    initialDesign,
    serializeCharacterDesign,
    async (current, revisionPrompt, version) => {
      const systemPrompt = `你是一位专业的微短剧编剧，擅长角色设计。请根据修改清单优化角色体系。
保留原设计的优点，只修改反馈中指出的问题。
输出完整的优化后角色设计，严格JSON格式。`;

      const userPrompt = `当前角色设计（${version}前版本）：
${JSON.stringify(current, null, 2)}

${revisionPrompt}

请输出优化后的完整角色设计，JSON格式与原设计一致。`;

      const result = await loopLLMJSON<CharacterDesign>(projectId, `loop_revise_chars_${version}`, systemPrompt, userPrompt, 'optimize', 'loop_revise');
      return result.success && result.data ? result.data : null;
    },
    loopConfig,
    onProgress,
  );
}

// ============================================================
// 分集目录闭环
// ============================================================

function serializeDirectory(directory: EpisodeDirectoryItem[]): string {
  return `【分集目录审阅】\n\n${directory.map(d =>
    `第${d.number}集「${d.title}」[${d.phase}][${d.mark || '常规'}] — ${d.summary}（钩子：${d.hookType}）`
  ).join('\n')}`;
}

export async function loopDirectory(
  projectId: string,
  initialDirectory: EpisodeDirectoryItem[],
  loopConfig?: Partial<LoopConfig>,
  onProgress?: (msg: string) => void,
): Promise<LoopResult<EpisodeDirectoryItem[]>> {
  return runCreationLoop<EpisodeDirectoryItem[]>(
    projectId,
    'directory',
    initialDirectory,
    serializeDirectory,
    async (current, revisionPrompt, version) => {
      const systemPrompt = `你是一位专业的微短剧编剧，擅长分集目录规划。请根据修改清单优化分集目录。
保留原目录的优点，只修改反馈中指出的问题。
输出完整的优化后分集目录，严格JSON数组格式。`;

      const userPrompt = `当前分集目录（${version}前版本）：
${JSON.stringify(current, null, 2)}

${revisionPrompt}

请输出优化后的完整分集目录，JSON数组格式与原目录一致。`;

      const result = await loopLLMJSON<EpisodeDirectoryItem[]>(projectId, `loop_revise_dir_${version}`, systemPrompt, userPrompt, 'optimize', 'loop_revise');
      if (!result.success || !result.data) return null;
      // 兼容LLM返回包裹对象
      let dir = result.data;
      if (!Array.isArray(dir)) {
        const arr = Object.values(dir as unknown as Record<string, unknown>).find(v => Array.isArray(v)) as EpisodeDirectoryItem[] | undefined;
        if (!arr?.length) return null;
        dir = arr;
      }
      return dir;
    },
    loopConfig,
    onProgress,
  );
}

// ============================================================
// 分集剧本闭环
// ============================================================

function serializeEpisode(episode: EpisodeScript): string {
  const scenes = episode.scenes?.map(s => {
    const dialogues = s.dialogues?.map(d => `  ${d.character}（${d.direction}）："${d.line}"`).join('\n') || '';
    return `场景${s.sceneNumber} [${s.location}]\n${s.description}\n${dialogues}\n${s.musicCue || ''}`;
  }).join('\n\n') || '';

  return `【第${episode.number}集「${episode.title}」审阅】
阶段：${episode.phase} | 钩子类型：${episode.hookType} | 标记：${episode.mark || '常规'}
前情提要：${episode.previousRecap || '无'}

${scenes}

结尾钩子：${episode.endHook || '无'}
下集预告：${episode.nextPreview || '无'}`;
}

export async function loopEpisode(
  projectId: string,
  initialEpisode: EpisodeScript,
  loopConfig?: Partial<LoopConfig>,
  onProgress?: (msg: string) => void,
): Promise<LoopResult<EpisodeScript>> {
  const episodeNumber = initialEpisode.number;

  return runCreationLoop<EpisodeScript>(
    projectId,
    `episode_${episodeNumber}`,
    initialEpisode,
    serializeEpisode,
    async (current, revisionPrompt, version) => {
      const systemPrompt = `你是一位专业的微短剧编剧。请根据修改清单优化第${episodeNumber}集剧本。
保留原剧本的优点和整体结构，只修改反馈中指出的问题。
不要改变剧情走向和关键情节点。
保持与前后集的剧情连贯性。
输出完整的优化后剧本，严格JSON格式。`;

      const userPrompt = `当前第${episodeNumber}集剧本（${version}前版本）：
${JSON.stringify(current, null, 2)}

${revisionPrompt}

请输出优化后的完整剧本，JSON格式与原剧本一致。`;

      const result = await loopLLMJSON<EpisodeScript>(projectId, `loop_revise_ep${episodeNumber}_${version}`, systemPrompt, userPrompt, 'optimize', 'loop_revise');
      if (!result.success || !result.data) return null;
      // 确保关键字段不丢失
      result.data.number = episodeNumber;
      result.data.phase = current.phase;
      result.data.hookType = current.hookType;
      result.data.mark = current.mark;
      return result.data;
    },
    loopConfig,
    onProgress,
  );
}

// ============================================================
// 情绪锚点图生成
// ============================================================

export interface EmotionAnchor {
  episode: number;
  minute: number;       // 大约第几分钟
  type: 'hook' | 'tension' | 'release' | 'paywall' | 'climax';
  intensity: number;    // 1-10
  description: string;
}

export async function generateEmotionMap(
  projectId: string,
  episodes: EpisodeScript[],
  onProgress?: (msg: string) => void,
): Promise<EmotionAnchor[]> {
  onProgress?.('📈 生成情绪锚点图...');

  const systemPrompt = `你是短剧情绪设计专家。请分析以下剧本的每一集，标注情绪锚点分布。

情绪锚点类型：
- hook: 钩子（抓住注意力的瞬间）
- tension: 张力积累（憋屈、压抑、悬念）
- release: 释放（爽点爆发、反转、打脸）
- paywall: 付费卡点（最强悬念）
- climax: 高潮（全集最高情绪点）

请为每集标注2-4个关键情绪锚点，标明大约在第几分钟、强度(1-10)和描述。

请严格按JSON数组格式输出：
[{"episode": 1, "minute": 0.5, "type": "hook", "intensity": 8, "description": "描述"}]`;

  const episodeSummaries = episodes.map(ep => {
    const sceneCount = ep.scenes?.length || 0;
    const dialogueCount = ep.scenes?.reduce((sum, s) => sum + (s.dialogues?.length || 0), 0) || 0;
    return `第${ep.number}集「${ep.title}」[${ep.phase}][${ep.mark || '常规'}]：${sceneCount}场景/${dialogueCount}轮台词，钩子：${ep.endHook || '无'}`;
  }).join('\n');

  const result = await loopLLMJSON<EmotionAnchor[]>(
    projectId, 'emotion_map', systemPrompt, episodeSummaries, 'evaluate', 'emotion_map'
  );

  if (!result.success || !result.data) return [];

  let anchors = result.data;
  if (!Array.isArray(anchors)) {
    const arr = Object.values(anchors as unknown as Record<string, unknown>).find(v => Array.isArray(v)) as EmotionAnchor[] | undefined;
    anchors = arr || [];
  }

  onProgress?.(`📈 情绪锚点图生成完成，共${anchors.length}个锚点`);
  return anchors;
}

// ============================================================
// 导出
// ============================================================

export {
  DEFAULT_LOOP_CONFIG,
  buildMentorSystemPrompt,
  buildHumanitySystemPrompt,
  buildRevisionPrompt,
  mentorReview,
  humanityReview,
  nexusJudge,
};
