// LLM调用统计面板 — 展示项目的所有LLM调用记录、按模型/阶段统计、提示词留痕查看
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface StatsData {
  summary: {
    total_calls: number;
    total_duration_ms: number;
    total_prompt_chars: number;
    total_response_chars: number;
    success_count: number;
    fail_count: number;
  };
  byModel: Array<{
    provider: string;
    model: string;
    calls: number;
    duration_ms: number;
    prompt_chars: number;
    response_chars: number;
  }>;
  byStep: Array<{
    step: string;
    calls: number;
    duration_ms: number;
    prompt_chars: number;
    response_chars: number;
    provider: string;
    model: string;
  }>;
}

interface LogEntry {
  id: number;
  step: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
  success: number;
  error: string | null;
  created_at: number;
}

interface LogDetail {
  id: number;
  step: string;
  provider: string;
  model: string;
  duration_ms: number;
  success: number;
  error: string | null;
  prompt_text: string | null;
  response_text: string | null;
  created_at: number;
}

interface LLMStatsViewProps {
  projectId: string;
  onBack: () => void;
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatChars(chars: number): string {
  if (chars < 1000) return `${chars}`;
  if (chars < 1000000) return `${(chars / 1000).toFixed(1)}K`;
  return `${(chars / 1000000).toFixed(2)}M`;
}

// 阶段名称映射
const STEP_LABELS: Record<string, string> = {
  creative_plan: '创意方案',
  character_design: '角色设计',
  match_pool_agents: '群演匹配',
  world_sim_round: '世界观模拟',
  world_sim_cross: '跨组互动',
  world_sim_summary: '模拟汇总',
  extract_final_characters: '角色提取',
  episode_directory: '分集目录',
  analyze_reference_novel: '小说解析',
  emotion_map: '情绪锚点图',
};

function getStepLabel(step: string): string {
  if (STEP_LABELS[step]) return STEP_LABELS[step];
  if (step.startsWith('episode_')) return `第${step.replace('episode_', '')}集`;
  if (step.startsWith('review_')) return `评审·第${step.replace('review_', '')}集`;
  if (step.startsWith('re_review_')) return `复审·第${step.replace('re_review_', '')}集`;
  if (step.startsWith('rewrite_')) return `改写·第${step.replace('rewrite_', '')}集`;
  if (step.startsWith('rewrite_retry_')) return `改写重试·第${step.replace('rewrite_retry_', '')}集`;
  if (step.startsWith('loop_mentor_')) return `导师审阅·${step.replace('loop_mentor_', '')}`;
  if (step.startsWith('loop_humanity_')) return `人性审阅·${step.replace('loop_humanity_', '')}`;
  if (step.startsWith('loop_nexus_')) return `中枢裁决·${step.replace('loop_nexus_', '')}`;
  if (step.startsWith('loop_revise_')) return `闭环修改·${step.replace('loop_revise_', '')}`;
  if (step.startsWith('world_sim_round_')) return `模拟·第${step.replace('world_sim_round_', '')}轮`;
  return step;
}

export default function LLMStatsView({ projectId, onBack }: LLMStatsViewProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'byModel' | 'byStep'>('summary');
  // 日志列表（按step展开时加载）
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  // 详情弹窗
  const [detailLog, setDetailLog] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/screenplay/${projectId}/llm-stats`)
      .then(r => r.json())
      .then(data => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  // 加载日志列表（首次展开step时触发）
  const loadLogEntries = async () => {
    if (logEntries.length > 0) return;
    try {
      const r = await fetch(`/api/screenplay/${projectId}/llm-logs`);
      const data = await r.json();
      if (Array.isArray(data?.logs)) setLogEntries(data.logs);
    } catch { /* ignore */ }
  };

  // 展开/收起某个step的日志
  const toggleStep = async (step: string) => {
    if (expandedStep === step) {
      setExpandedStep(null);
      return;
    }
    await loadLogEntries();
    setExpandedStep(step);
  };

  // 加载单条日志详情
  const loadDetail = async (logId: number) => {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/screenplay/llm-log/${logId}`);
      const data = await r.json();
      setDetailLog(data);
    } catch { /* ignore */ }
    setDetailLoading(false);
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;
  }

  if (!stats || !stats.summary?.total_calls) {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', marginBottom: 16 }}>
          <ArrowLeftIcon className="" /> 返回
        </button>
        <div style={{ textAlign: 'center', color: '#6b7280', padding: 40 }}>{t('llmStats.noData')}</div>
      </div>
    );
  }

  const { summary, byModel, byStep } = stats;

  return (
    <div style={{ padding: 16, maxHeight: '100%', overflow: 'auto' }}>
      {/* 顶部导航 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}>
          <ArrowLeftIcon className="" /> 返回
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb' }}>{t('llmStats.title')}</span>
      </div>

      {/* 总览卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label={t('llmStats.totalCalls')} value={`${summary.success_count}/${summary.total_calls}`} sub={`${summary.fail_count} ${t('llmStats.failCalls')}`} color="#3b82f6" />
        <StatCard label={t('llmStats.totalDuration')} value={formatDuration(summary.total_duration_ms || 0)} color="#f59e0b" />
        <StatCard label={t('llmStats.totalPromptChars')} value={formatChars(summary.total_prompt_chars || 0)} sub={`响应 ${formatChars(summary.total_response_chars || 0)}`} color="#10b981" />
      </div>

      {/* Tab切换 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['summary', 'byModel', 'byStep'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              padding: '4px 12px', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer',
              background: activeTab === tab ? '#3b82f6' : '#374151', color: activeTab === tab ? '#fff' : '#9ca3af',
            }}>
            {tab === 'summary' ? '总览' : tab === 'byModel' ? t('llmStats.byModel') : t('llmStats.byStep')}
          </button>
        ))}
      </div>

      {/* 按模型统计 */}
      {activeTab === 'byModel' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {byModel.map((m, i) => (
            <div key={i} style={{ background: '#1f2937', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#e5e7eb', fontWeight: 500 }}>{m.provider}/{m.model}</span>
                <span style={{ color: '#3b82f6' }}>{m.calls} 次</span>
              </div>
              <div style={{ display: 'flex', gap: 12, color: '#9ca3af', fontSize: 11 }}>
                <span>耗时 {formatDuration(m.duration_ms || 0)}</span>
                <span>提示词 {formatChars(m.prompt_chars || 0)}</span>
                <span>响应 {formatChars(m.response_chars || 0)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 按阶段统计（可展开查看日志列表） */}
      {activeTab === 'byStep' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {byStep.map((s, i) => {
            const isExpanded = expandedStep === s.step;
            const stepLogs = logEntries.filter(l => l.step === s.step);
            return (
              <div key={i}>
                <div
                  onClick={() => toggleStep(s.step)}
                  style={{ background: '#1f2937', borderRadius: isExpanded ? '6px 6px 0 0' : 6, padding: '8px 12px', fontSize: 12, cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ color: '#e5e7eb', fontWeight: 500 }}>
                      {isExpanded ? '▼' : '▶'} {getStepLabel(s.step)}
                    </span>
                    <span style={{ color: '#6b7280', fontSize: 11 }}>{s.provider}/{s.model}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, color: '#9ca3af', fontSize: 11 }}>
                    <span>{s.calls}次</span>
                    <span>{formatDuration(s.duration_ms || 0)}</span>
                    <span>提示词 {formatChars(s.prompt_chars || 0)}</span>
                    <span>响应 {formatChars(s.response_chars || 0)}</span>
                  </div>
                </div>
                {/* 展开的日志列表 */}
                {isExpanded && (
                  <div style={{ background: '#111827', borderRadius: '0 0 6px 6px', padding: '4px 8px', maxHeight: 240, overflow: 'auto' }}>
                    {stepLogs.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#6b7280', padding: 8, textAlign: 'center' }}>无日志记录</div>
                    ) : stepLogs.map(log => (
                      <div
                        key={log.id}
                        onClick={() => loadDetail(log.id)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '5px 8px', fontSize: 11, borderBottom: '1px solid #1f2937',
                          cursor: 'pointer', color: '#d1d5db',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#1f2937')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: log.success ? '#10b981' : '#ef4444' }}>{log.success ? '✓' : '✗'}</span>
                          <span>{log.provider}/{log.model}</span>
                        </span>
                        <span style={{ display: 'flex', gap: 8, color: '#6b7280' }}>
                          <span>{formatDuration(log.duration_ms || 0)}</span>
                          <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                          <span style={{ color: '#3b82f6' }}>查看 →</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 总览：模型占比+阶段时间线 */}
      {activeTab === 'summary' && <SummaryTab summary={summary} byModel={byModel} byStep={byStep} />}

      {/* 详情弹窗 */}
      {(detailLog || detailLoading) && (
        <DetailModal log={detailLog} loading={detailLoading} onClose={() => setDetailLog(null)} t={t} />
      )}
    </div>
  );
}

/* ---- 总览Tab ---- */
function SummaryTab({ summary, byModel, byStep }: Pick<StatsData, 'summary' | 'byModel' | 'byStep'>) {
  return (
    <div>
      {/* 模型占比条 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>模型调用占比</div>
        <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden' }}>
          {byModel.map((m, i) => {
            const pct = summary.total_calls ? (m.calls / summary.total_calls) * 100 : 0;
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];
            return (
              <div key={i} title={`${m.provider}/${m.model}: ${m.calls}次 (${pct.toFixed(1)}%)`}
                style={{ width: `${pct}%`, background: colors[i % colors.length], minWidth: pct > 0 ? 2 : 0 }} />
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          {byModel.map((m, i) => {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];
            return (
              <span key={i} style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], display: 'inline-block' }} />
                {m.model} ({m.calls})
              </span>
            );
          })}
        </div>
      </div>

      {/* 耗时分布 */}
      <div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>阶段耗时分布</div>
        {byStep.slice(0, 20).map((s, i) => {
          const maxDur = Math.max(...byStep.map(x => x.duration_ms || 0));
          const pct = maxDur ? ((s.duration_ms || 0) / maxDur) * 100 : 0;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 120, flexShrink: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {getStepLabel(s.step)}
              </span>
              <div style={{ flex: 1, height: 12, background: '#374151', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#3b82f6', borderRadius: 2, minWidth: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: '#6b7280', width: 50, textAlign: 'right', flexShrink: 0 }}>
                {formatDuration(s.duration_ms || 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- 详情弹窗 ---- */
function DetailModal({ log, loading, onClose, t }: { log: LogDetail | null; loading: boolean; onClose: () => void; t: (key: string) => string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 16, maxWidth: 700, maxHeight: '80vh', overflow: 'auto', width: '90%' }}
        onClick={e => e.stopPropagation()}>
        {loading && !log ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: 20 }}>加载中...</div>
        ) : log ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, color: '#e5e7eb' }}>{getStepLabel(log.step)}</span>
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
              {log.provider}/{log.model} · {formatDuration(log.duration_ms)} · {log.success ? '✅成功' : '❌失败'}
              {log.created_at && <span> · {new Date(log.created_at).toLocaleString()}</span>}
            </div>
            {log.prompt_text && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 4 }}>{t('llmStats.promptText')}</div>
                <pre style={{ background: '#111827', padding: 8, borderRadius: 4, fontSize: 11, color: '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
                  {log.prompt_text}
                </pre>
              </div>
            )}
            {log.response_text && (
              <div>
                <div style={{ fontSize: 12, color: '#10b981', marginBottom: 4 }}>{t('llmStats.responseText')}</div>
                <pre style={{ background: '#111827', padding: 8, borderRadius: 4, fontSize: 11, color: '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
                  {log.response_text}
                </pre>
              </div>
            )}
            {log.error && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 4 }}>错误信息</div>
                <pre style={{ background: '#111827', padding: 8, borderRadius: 4, fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
                  {log.error}
                </pre>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ---- 统计卡片 ---- */
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: '#1f2937', borderRadius: 6, padding: '10px 12px', borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#e5e7eb' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
