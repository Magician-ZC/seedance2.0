// 剧本评分视图 — 评审模式选择、角色选择、评分进度、结果展示
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import RadarChart from './RadarChart';
import type { RadarDataset } from './RadarChart';
import type {
  ArenaScreenplayInfo,
  ArenaScoreResult,
  ReviewRole,
  DimensionScores,
} from '../../server/src/arena-types';

interface ScoreViewProps {
  screenplays: ArenaScreenplayInfo[];
  onBack: () => void;
}

type Step = 'select' | 'mode' | 'scoring' | 'result';

const ROLES: { key: ReviewRole; color: string }[] = [
  { key: 'hitScreenwriter', color: '#f59e0b' },
  { key: 'platformReviewer', color: '#3b82f6' },
  { key: 'audienceProxy', color: '#10b981' },
  { key: 'authorAgent', color: '#a855f7' },
];

const DIMENSION_KEYS: (keyof DimensionScores)[] = [
  'plotStructure', 'characterization', 'dialogueQuality',
  'pacing', 'creativity', 'commercialPotential',
];

export default function ScoreView({ screenplays, onBack }: ScoreViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'single' | 'panel'>('panel');
  const [result, setResult] = useState<ArenaScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set());

  const handleSelectScreenplay = (id: string) => {
    setSelectedId(id);
    setStep('mode');
  };

  const handleStartScore = async (m: 'single' | 'panel', role?: ReviewRole) => {
    setMode(m);
    setStep('scoring');
    setError(null);

    try {
      const body: Record<string, unknown> = { screenplayId: selectedId, mode: m };
      if (m === 'single' && role) body.roleKey = role;
      const res = await fetch('/api/arena/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data: ArenaScoreResult = await res.json();
      setResult(data);
      setStep('result');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '评分请求失败';
      setError(msg);
      setStep('mode');
    }
  };

  const toggleDim = (dim: string) => {
    setExpandedDims(prev => {
      const next = new Set(prev);
      next.has(dim) ? next.delete(dim) : next.add(dim);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8">
        {/* Header */}
        <button
          onClick={step === 'select' ? onBack : () => setStep(step === 'result' ? 'mode' : 'select')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {t('arena.back')}
        </button>

        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <span className="w-1.5 h-5 bg-blue-500 rounded-full" />
          {t('arena.score')}
        </h2>

        {/* Step 1: Select screenplay */}
        {step === 'select' && (
          <ScreenplaySelector screenplays={screenplays} onSelect={handleSelectScreenplay} t={t} />
        )}

        {/* Step 2: Mode selection */}
        {step === 'mode' && (
          <ModeSelector
            onPanel={() => handleStartScore('panel')}
            onSingle={(role) => handleStartScore('single', role)}
            error={error}
            t={t}
          />
        )}

        {/* Step 3: Scoring progress */}
        {step === 'scoring' && <ScoringProgress t={t} />}

        {/* Step 4: Results */}
        {step === 'result' && result && (
          <ScoreResult
            result={result}
            mode={mode}
            expandedDims={expandedDims}
            onToggleDim={toggleDim}
            t={t}
          />
        )}
      </div>
    </div>
  );
}


/* ---- Step 1: 剧本选择 ---- */
function ScreenplaySelector({
  screenplays,
  onSelect,
  t,
}: {
  screenplays: ArenaScreenplayInfo[];
  onSelect: (id: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">{t('arena.selectScreenplay')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {screenplays.map(sp => (
          <button
            key={sp.id}
            onClick={() => onSelect(sp.id)}
            className="text-left p-4 rounded-xl bg-[#141414] border border-white/5 hover:border-blue-500/30 hover:bg-[#1a1a1a] transition-all group"
          >
            <p className="text-sm text-gray-200 font-medium line-clamp-1 group-hover:text-white">
              {sp.title}
            </p>
            <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500">
              <span className="bg-white/5 px-1.5 py-0.5 rounded">
                {t('arena.episodes', { count: sp.episodeCount })}
              </span>
              <span className="bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded">
                ELO {sp.elo}
              </span>
              {sp.generation > 0 && (
                <span className="bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded">
                  {t('arena.generation', { gen: sp.generation })}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- Step 2: 模式选择 ---- */
function ModeSelector({
  onPanel,
  onSingle,
  error,
  t,
}: {
  onPanel: () => void;
  onSingle: (role: ReviewRole) => void;
  error: string | null;
  t: (key: string) => string;
}) {
  const [showRoles, setShowRoles] = useState(false);

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        {/* 评审团模式 */}
        <button
          onClick={onPanel}
          className="p-5 rounded-xl bg-[#141414] border border-white/5 hover:border-blue-500/30 hover:bg-[#1a1a1a] transition-all text-left group"
        >
          <div className="flex items-center gap-2 mb-2">
            <UsersIcon className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-semibold text-white">{t('arena.reviewMode.panel')}</span>
          </div>
          <div className="flex gap-1 mt-2">
            {ROLES.map(r => (
              <span key={r.key} className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
            ))}
          </div>
        </button>

        {/* 单角色模式 */}
        <button
          onClick={() => setShowRoles(true)}
          className="p-5 rounded-xl bg-[#141414] border border-white/5 hover:border-orange-500/30 hover:bg-[#1a1a1a] transition-all text-left group"
        >
          <div className="flex items-center gap-2 mb-2">
            <UserIcon className="w-5 h-5 text-orange-400" />
            <span className="text-sm font-semibold text-white">{t('arena.reviewMode.single')}</span>
          </div>
        </button>
      </div>

      {/* 角色选择 */}
      {showRoles && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl">
          {ROLES.map(r => (
            <button
              key={r.key}
              onClick={() => onSingle(r.key)}
              className="p-3 rounded-xl bg-[#141414] border border-white/5 hover:bg-[#1a1a1a] transition-all text-center"
              style={{ borderColor: `${r.color}30` }}
            >
              <span className="inline-block w-3 h-3 rounded-full mb-2" style={{ backgroundColor: r.color }} />
              <p className="text-xs text-gray-300">{t(`arena.roles.${r.key}`)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Step 3: 评分进度 ---- */
function ScoringProgress({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
      <p className="text-sm text-gray-400">{t('arena.scoring')}</p>
    </div>
  );
}


/* ---- Step 4: 评分结果 ---- */
function ScoreResult({
  result,
  mode,
  expandedDims,
  onToggleDim,
  t,
}: {
  result: ArenaScoreResult;
  mode: 'single' | 'panel';
  expandedDims: Set<string>;
  onToggleDim: (dim: string) => void;
  t: (key: string) => string;
}) {
  // 构建雷达图数据集
  const datasets: RadarDataset[] = result.roleScores.map(rs => {
    const roleInfo = ROLES.find(r => r.key === rs.role);
    return {
      label: t(`arena.roles.${rs.role}`),
      color: roleInfo?.color ?? '#888',
      scores: rs.scores,
    };
  });

  // 综合得分平均值
  const avgScore = DIMENSION_KEYS.reduce((sum, k) => sum + result.finalScores[k], 0) / 6;

  return (
    <div className="space-y-8">
      {/* 跳过角色提示 */}
      {result.skippedRoles.length > 0 && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
          {result.skippedRoles.map(r => t(`arena.roles.${r}`)).join(', ')} — skipped
        </div>
      )}

      {/* 雷达图 */}
      <div className="flex justify-center">
        <RadarChart datasets={datasets} size={320} showLabels showLegend={mode === 'panel'} />
      </div>

      {/* 综合得分 */}
      <div className="flex items-center justify-center gap-4 py-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-white">{avgScore.toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-1">{t('arena.score')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {DIMENSION_KEYS.map(k => (
            <div key={k} className="text-center px-3 py-1.5 rounded-lg bg-white/5">
              <p className="text-xs text-gray-500">{t(`arena.dimensions.${k}`)}</p>
              <p className="text-sm font-semibold text-white">{result.finalScores[k].toFixed(1)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 各维度点评（可展开/折叠） */}
      <div className="space-y-2">
        {DIMENSION_KEYS.map(dim => {
          const expanded = expandedDims.has(dim);
          return (
            <div key={dim} className="rounded-xl bg-[#141414] border border-white/5 overflow-hidden">
              <button
                onClick={() => onToggleDim(dim)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-300">{t(`arena.dimensions.${dim}`)}</span>
                  <span className="text-sm font-semibold text-white">{result.finalScores[dim].toFixed(1)}</span>
                </div>
                <ChevronIcon className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  {/* 综合点评 */}
                  <p className="text-xs text-gray-400 leading-relaxed">{result.finalComments[dim]}</p>
                  {/* 各角色点评 */}
                  {result.roleScores.length > 1 && result.roleScores.map(rs => {
                    const roleInfo = ROLES.find(r => r.key === rs.role);
                    return (
                      <div key={rs.role} className="flex gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: roleInfo?.color }} />
                        <div>
                          <span className="text-gray-500">{t(`arena.roles.${rs.role}`)} ({rs.scores[dim].toFixed(1)})</span>
                          <p className="text-gray-400 mt-0.5">{rs.comments[dim]}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- 内联图标 ---- */
function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
