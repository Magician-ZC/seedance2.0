// 剧本对战视图 — 选择剧本、ELO差距提示、对战进度、逐维度对比、最终裁决、进化入口
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ArenaScreenplayInfo,
  BattleResult,
} from '../../server/src/arena-types';

interface BattleViewProps {
  screenplays: ArenaScreenplayInfo[];
  onBack: () => void;
  onEvolve: (loserId: string, winnerId: string, battleId: string) => void;
}

type Step = 'select' | 'battling' | 'result';

export default function BattleView({ screenplays, onBack, onEvolve }: BattleViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('select');
  const [idA, setIdA] = useState<string | null>(null);
  const [idB, setIdB] = useState<string | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spA = screenplays.find(s => s.id === idA);
  const spB = screenplays.find(s => s.id === idB);
  const eloGap = spA && spB ? Math.abs(spA.elo - spB.elo) : 0;

  const handleStartBattle = async () => {
    if (!idA || !idB) return;
    setStep('battling');
    setError(null);
    try {
      const res = await fetch('/api/arena/battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenplayIdA: idA, screenplayIdB: idB }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BattleResult = await res.json();
      setResult(data);
      setStep('result');
    } catch {
      setError(t('common.loading'));
      setStep('select');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8">
        {/* Header */}
        <button
          onClick={step === 'select' ? onBack : () => setStep('select')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {t('arena.back')}
        </button>
        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <span className="w-1.5 h-5 bg-red-500 rounded-full" />
          {t('arena.battle')}
        </h2>

        {step === 'select' && (
          <SelectStep
            screenplays={screenplays}
            idA={idA} idB={idB}
            onSelectA={setIdA} onSelectB={setIdB}
            eloGap={eloGap}
            error={error}
            onStart={handleStartBattle}
            t={t}
          />
        )}

        {step === 'battling' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-400">{t('arena.battling')}</p>
          </div>
        )}

        {step === 'result' && result && (
          <ResultStep
            result={result}
            spA={spA!} spB={spB!}
            onEvolve={onEvolve}
            t={t}
          />
        )}
      </div>
    </div>
  );
}


/* ---- Step 1: 选择对战双方 ---- */
function SelectStep({
  screenplays, idA, idB, onSelectA, onSelectB,
  eloGap, error, onStart, t,
}: {
  screenplays: ArenaScreenplayInfo[];
  idA: string | null; idB: string | null;
  onSelectA: (id: string | null) => void;
  onSelectB: (id: string | null) => void;
  eloGap: number;
  error: string | null;
  onStart: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Side A */}
        <div className="space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider">A</p>
          <ScreenplayPicker
            screenplays={screenplays}
            selected={idA}
            excludeId={idB}
            onSelect={onSelectA}
            t={t}
          />
        </div>
        {/* Side B */}
        <div className="space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider">B</p>
          <ScreenplayPicker
            screenplays={screenplays}
            selected={idB}
            excludeId={idA}
            onSelect={onSelectB}
            t={t}
          />
        </div>
      </div>

      {/* ELO gap warning */}
      {idA && idB && eloGap > 400 && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs flex items-center gap-2">
          <WarningIcon className="w-4 h-4 flex-shrink-0" />
          {t('arena.eloWarning')}
        </div>
      )}

      {/* Start button */}
      <button
        onClick={onStart}
        disabled={!idA || !idB}
        className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {t('arena.startBattle')}
      </button>
    </div>
  );
}

/* ---- 剧本选择器 ---- */
function ScreenplayPicker({
  screenplays, selected, excludeId, onSelect, t,
}: {
  screenplays: ArenaScreenplayInfo[];
  selected: string | null;
  excludeId: string | null;
  onSelect: (id: string | null) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
      {screenplays.map(sp => {
        const isExcluded = sp.id === excludeId;
        const isSelected = sp.id === selected;
        return (
          <button
            key={sp.id}
            disabled={isExcluded}
            onClick={() => onSelect(isSelected ? null : sp.id)}
            className={`w-full text-left p-3 rounded-xl border transition-all ${
              isSelected
                ? 'bg-red-500/10 border-red-500/30 ring-1 ring-red-500/20'
                : isExcluded
                  ? 'bg-[#111] border-white/5 opacity-30 cursor-not-allowed'
                  : 'bg-[#141414] border-white/5 hover:border-red-500/20 hover:bg-[#1a1a1a]'
            }`}
          >
            <p className="text-sm text-gray-200 font-medium line-clamp-1">{sp.title}</p>
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
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
        );
      })}
    </div>
  );
}


/* ---- Step 3: 对战结果 ---- */
function ResultStep({
  result, spA, spB, onEvolve, t,
}: {
  result: BattleResult;
  spA: ArenaScreenplayInfo;
  spB: ArenaScreenplayInfo;
  onEvolve: (loserId: string, winnerId: string, battleId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const verdictLabel = result.finalVerdict === 'a'
    ? spA.title
    : result.finalVerdict === 'b'
      ? spB.title
      : t('arena.draw');

  const loserId = result.finalVerdict === 'a' ? result.screenplayIdB
    : result.finalVerdict === 'b' ? result.screenplayIdA
      : null;
  const winnerId = result.finalVerdict === 'a' ? result.screenplayIdA
    : result.finalVerdict === 'b' ? result.screenplayIdB
      : null;

  return (
    <div className="space-y-8">
      {/* Final verdict banner */}
      <div className="p-6 rounded-2xl bg-[#141414] border border-white/5 text-center space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">
          {result.finalVerdict === 'draw' ? t('arena.draw') : t('arena.win')}
        </p>
        <p className="text-xl font-bold text-white">{verdictLabel}</p>
        <div className="flex items-center justify-center gap-6 text-sm">
          <EloChange label={spA.title} change={result.eloChangeA} />
          <span className="text-gray-600">vs</span>
          <EloChange label={spB.title} change={result.eloChangeB} />
        </div>
      </div>

      {/* Per-dimension comparison */}
      <div className="space-y-3">
        {result.dimensionResults.map(dim => (
          <DimensionBar
            key={dim.dimension}
            dim={dim}
            t={t}
          />
        ))}
      </div>

      {/* Improvement suggestions */}
      {result.improvementSuggestions.length > 0 && (
        <div className="p-4 rounded-xl bg-[#141414] border border-white/5 space-y-2">
          <p className="text-xs text-gray-500 font-medium">
            {loserId === result.screenplayIdA ? spA.title : spB.title} — 改进建议
          </p>
          <ul className="space-y-1.5">
            {result.improvementSuggestions.map((s, i) => (
              <li key={i} className="text-xs text-gray-400 flex gap-2">
                <span className="text-gray-600 flex-shrink-0">•</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Absorb Evolution button */}
      {loserId && winnerId && (
        <button
          onClick={() => onEvolve(loserId, winnerId, result.id)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20 transition-all hover:scale-105 active:scale-95"
        >
          <EvolutionIcon className="w-4 h-4" />
          {t('arena.evolution')}
        </button>
      )}
    </div>
  );
}

/* ---- ELO 变化展示 ---- */
function EloChange({ label, change }: { label: string; change: number }) {
  const color = change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-500';
  const sign = change > 0 ? '+' : '';
  return (
    <div className="text-center">
      <p className="text-xs text-gray-400 line-clamp-1 max-w-[120px]">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{sign}{change}</p>
    </div>
  );
}

/* ---- 维度对比条 ---- */
function DimensionBar({
  dim, t,
}: {
  dim: BattleResult['dimensionResults'][number];
  t: (key: string) => string;
}) {
  const widthA = (dim.scoreA / 10) * 100;
  const widthB = (dim.scoreB / 10) * 100;
  const winnerIsA = dim.winner === 'a';
  const winnerIsB = dim.winner === 'b';

  return (
    <div className="p-3 rounded-xl bg-[#141414] border border-white/5 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{t(`arena.dimensions.${dim.dimension}`)}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          dim.winner === 'draw'
            ? 'bg-gray-500/10 text-gray-400'
            : winnerIsA
              ? 'bg-blue-500/10 text-blue-400'
              : 'bg-orange-500/10 text-orange-400'
        }`}>
          {dim.winner === 'draw' ? t('arena.draw') : dim.winner === 'a' ? `A ${t('arena.win')}` : `B ${t('arena.win')}`}
        </span>
      </div>
      {/* Score bars */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-8 text-right">{dim.scoreA.toFixed(1)}</span>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${winnerIsA ? 'bg-blue-500' : 'bg-blue-500/40'}`}
              style={{ width: `${widthA}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-8 text-right">{dim.scoreB.toFixed(1)}</span>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${winnerIsB ? 'bg-orange-500' : 'bg-orange-500/40'}`}
              style={{ width: `${widthB}%` }}
            />
          </div>
        </div>
      </div>
      {/* Comment */}
      {dim.comment && (
        <p className="text-[10px] text-gray-500 leading-relaxed">{dim.comment}</p>
      )}
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

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}

function EvolutionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3" /><path d="M18.5 13h-13" /><path d="m8 17-4-4 4-4" /><path d="m16 7 4 4-4 4" />
      <path d="M12 18v3" />
    </svg>
  );
}
