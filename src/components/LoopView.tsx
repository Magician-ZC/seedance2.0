// 闭环创作迭代记录视图 — 展示导师Agent/人性Agent审阅结果、中枢裁决、情绪锚点图
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// 类型定义（与后端 creation-loop.ts 对齐）
interface FeedbackItem {
  location: string;
  issue: string;
  suggestion: string;
  severity: 'critical' | 'major' | 'minor';
}

interface AgentReview {
  agentType: 'mentor' | 'humanity';
  score: number;
  feedbacks: FeedbackItem[];
  summary: string;
}

interface LoopScores {
  logicTruth: number;
  emotionHook: number;
  dialogueStyle: number;
}

interface NexusVerdict {
  mergedFeedbacks: FeedbackItem[];
  conflictResolutions: string[];
  priorityActions: string[];
  passThreshold: boolean;
  scores: LoopScores;
}

interface LoopIteration {
  version: string;
  mentorReview: AgentReview;
  humanityReview: AgentReview;
  nexusVerdict: NexusVerdict;
  timestamp: number;
}

interface EmotionAnchor {
  episode: number;
  minute: number;
  type: 'hook' | 'tension' | 'release' | 'paywall' | 'climax';
  intensity: number;
  description: string;
}

interface LoopViewProps {
  projectId: string;
  onBack: () => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  major: '#f59e0b',
  minor: '#6b7280',
};

const ANCHOR_COLORS: Record<string, string> = {
  hook: '#3b82f6',
  tension: '#f59e0b',
  release: '#10b981',
  paywall: '#ef4444',
  climax: '#a855f7',
};

// 箭头图标
function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

export default function LoopView({ projectId, onBack }: LoopViewProps) {
  const { t } = useTranslation();
  const [iterations, setIterations] = useState<Record<string, LoopIteration[]>>({});
  const [emotionMap, setEmotionMap] = useState<EmotionAnchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [activeIteration, setActiveIteration] = useState<number>(0);
  const [generatingMap, setGeneratingMap] = useState(false);

  useEffect(() => {
    fetchData();
  }, [projectId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/screenplay/${projectId}/loop-iterations`);
      const data = await res.json();
      setIterations(data.loopIterations || {});
      setEmotionMap(data.emotionMap || []);
      // 默认选中第一个有数据的步骤
      const steps = Object.keys(data.loopIterations || {});
      if (steps.length > 0) setActiveStep(steps[0]);
    } catch { /* 静默 */ } finally {
      setLoading(false);
    }
  };

  const handleGenerateEmotionMap = async () => {
    setGeneratingMap(true);
    try {
      const res = await fetch(`/api/screenplay/${projectId}/emotion-map`, { method: 'POST' });
      if (res.ok) {
        // 轮询等待完成
        await new Promise(resolve => setTimeout(resolve, 3000));
        await fetchData();
      }
    } catch { /* 静默 */ } finally {
      setGeneratingMap(false);
    }
  };

  const stepNames: Record<string, string> = {
    creative_plan: '创作方案',
    character_design: '角色设计',
    directory: '分集目录',
  };
  // 动态添加分集步骤名
  Object.keys(iterations).forEach(key => {
    if (key.startsWith('episode_')) {
      const num = key.replace('episode_', '');
      stepNames[key] = `第${num}集`;
    }
  });

  const steps = Object.keys(iterations);
  const currentIterations = activeStep ? iterations[activeStep] || [] : [];
  const currentIter = currentIterations[activeIteration];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
        <div className="max-w-[1200px] mx-auto px-6 py-8">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6">
            <ArrowLeftIcon className="w-4 h-4" />
            {t('arena.back')}
          </button>
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-2">暂无闭环迭代记录</p>
            <p className="text-sm">请在创建剧本时启用"闭环创作模式"</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8">
        {/* Header */}
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6">
          <ArrowLeftIcon className="w-4 h-4" />
          {t('arena.back')}
        </button>
        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <span className="w-1.5 h-5 bg-blue-500 rounded-full" />
          {t('loop.title')}
        </h2>

        {/* 步骤选择 */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {steps.map(step => (
            <button
              key={step}
              onClick={() => { setActiveStep(step); setActiveIteration(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeStep === step
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent'
              }`}
            >
              {stepNames[step] || step}
              <span className="ml-1 text-gray-500">({iterations[step].length}轮)</span>
            </button>
          ))}
        </div>

        {currentIter && (
          <>
            {/* 迭代版本切换 */}
            {currentIterations.length > 1 && (
              <div className="flex gap-2 mb-4">
                {currentIterations.map((iter, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveIteration(idx)}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      activeIteration === idx
                        ? 'bg-white/10 text-white'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {iter.version}
                    {iter.nexusVerdict.passThreshold && ' ✅'}
                  </button>
                ))}
              </div>
            )}

            {/* 评分概览 */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <ScoreCard label={t('loop.logicTruth')} score={currentIter.nexusVerdict.scores.logicTruth} threshold={90} color="#3b82f6" />
              <ScoreCard label={t('loop.emotionHook')} score={currentIter.nexusVerdict.scores.emotionHook} threshold={95} color="#ef4444" />
              <ScoreCard label={t('loop.dialogueStyle')} score={currentIter.nexusVerdict.scores.dialogueStyle} threshold={85} color="#10b981" />
            </div>

            {/* 导师Agent + 人性Agent 并排 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <AgentCard review={currentIter.mentorReview} label={t('loop.mentor')} color="#3b82f6" />
              <AgentCard review={currentIter.humanityReview} label={t('loop.humanity')} color="#ef4444" />
            </div>

            {/* 中枢裁决 */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 mb-6">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                {t('loop.nexus')}
                <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                  currentIter.nexusVerdict.passThreshold ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {currentIter.nexusVerdict.passThreshold ? t('loop.passed') : t('loop.notPassed')}
                </span>
              </h3>

              {/* 冲突裁决 */}
              {currentIter.nexusVerdict.conflictResolutions.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1">冲突裁决：</p>
                  {currentIter.nexusVerdict.conflictResolutions.map((c, i) => (
                    <p key={i} className="text-xs text-purple-300 ml-2">• {c}</p>
                  ))}
                </div>
              )}

              {/* 优先修改项 */}
              {currentIter.nexusVerdict.priorityActions.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1">优先修改项：</p>
                  {currentIter.nexusVerdict.priorityActions.map((p, i) => (
                    <p key={i} className="text-xs text-yellow-300 ml-2">{i + 1}. {p}</p>
                  ))}
                </div>
              )}

              {/* 合并反馈列表 */}
              <div>
                <p className="text-xs text-gray-400 mb-2">
                  合并反馈（{currentIter.nexusVerdict.mergedFeedbacks.length}条）：
                </p>
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                  {currentIter.nexusVerdict.mergedFeedbacks.map((f, i) => (
                    <FeedbackCard key={i} feedback={f} />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* 情绪锚点图 */}
        <div className="bg-white/5 rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              {t('loop.emotionMap')}
            </h3>
            <button
              onClick={handleGenerateEmotionMap}
              disabled={generatingMap}
              className="px-3 py-1 text-xs bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              {generatingMap ? '生成中...' : t('loop.generateEmotionMap')}
            </button>
          </div>

          {emotionMap.length > 0 ? (
            <div className="space-y-1">
              {emotionMap.map((anchor, i) => (
                <div key={i} className="flex items-center gap-3 text-xs py-1">
                  <span className="text-gray-500 w-16 shrink-0">EP{anchor.episode} {anchor.minute}′</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                    style={{ backgroundColor: `${ANCHOR_COLORS[anchor.type]}20`, color: ANCHOR_COLORS[anchor.type] }}
                  >
                    {t(`loop.anchorTypes.${anchor.type}` as any)}
                  </span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${anchor.intensity * 10}%`, backgroundColor: ANCHOR_COLORS[anchor.type] }}
                      />
                    </div>
                    <span className="text-gray-400 truncate">{anchor.description}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-4">{t('loop.emotionMapHint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// 评分卡片
function ScoreCard({ label, score, threshold, color }: { label: string; score: number; threshold: number; color: string }) {
  const passed = score >= threshold;
  return (
    <div className="bg-white/5 rounded-xl border border-white/10 p-3 text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: passed ? color : '#f59e0b' }}>{score}</p>
      <p className="text-[10px] text-gray-500">目标 ≥ {threshold}</p>
    </div>
  );
}

// Agent审阅卡片
function AgentCard({ review, label, color }: { review: AgentReview; label: string; color: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white/5 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </h4>
        <span className="text-lg font-bold" style={{ color }}>{review.score}</span>
      </div>
      <p className="text-xs text-gray-400 mb-2">{review.summary}</p>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        {expanded ? '收起' : `展开 ${review.feedbacks.length} 条反馈`}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
          {review.feedbacks.map((f, i) => (
            <FeedbackCard key={i} feedback={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// 反馈条目卡片
function FeedbackCard({ feedback }: { feedback: FeedbackItem }) {
  return (
    <div className="bg-black/20 rounded-lg p-2 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: `${SEVERITY_COLORS[feedback.severity]}20`, color: SEVERITY_COLORS[feedback.severity] }}
        >
          {feedback.severity}
        </span>
        <span className="text-gray-400">{feedback.location}</span>
      </div>
      <p className="text-gray-300 mb-1">问题：{feedback.issue}</p>
      <p className="text-green-400/80">建议：{feedback.suggestion}</p>
    </div>
  );
}
