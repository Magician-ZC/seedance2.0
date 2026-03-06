// 进化视图 — 进化方案展示、元素勾选、进化方式选择、执行进化
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { EvolutionPlan, EvolutionElement } from '../../server/src/arena-types';

interface EvolutionViewProps {
  loserId: string;
  winnerId: string;
  battleId: string;
  onBack: () => void;
  onComplete: () => void;
}

type Step = 'loading' | 'plan' | 'evolving' | 'success';
type EvolutionType = 'enhance' | 'expand' | 'style_merge';

const CATEGORY_COLORS: Record<EvolutionElement['category'], string> = {
  plot: '#f59e0b',
  character: '#3b82f6',
  dialogue: '#10b981',
  pacing: '#a855f7',
  scene: '#ec4899',
  style: '#06b6d4',
};

export default function EvolutionView({ loserId, winnerId, battleId, onBack, onComplete }: EvolutionViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('loading');
  const [plan, setPlan] = useState<EvolutionPlan | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [evolutionType, setEvolutionType] = useState<EvolutionType>('enhance');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; title: string; generation: number } | null>(null);

  // 加载进化方案
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/arena/evolve/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loserId, winnerId, battleId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: EvolutionPlan = await res.json();
        setPlan(data);
        // 默认全选
        setSelectedIds(new Set(data.elements.map(e => e.id)));
        setStep('plan');
      } catch {
        setError('加载进化方案失败');
        setStep('plan');
      }
    })();
  }, [loserId, winnerId, battleId]);

  const allSelected = plan ? selectedIds.size === plan.elements.length : false;

  const toggleAll = () => {
    if (!plan) return;
    setSelectedIds(allSelected ? new Set() : new Set(plan.elements.map(e => e.id)));
  };

  const toggleElement = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExecute = async () => {
    if (selectedIds.size === 0) return;
    setStep('evolving');
    setError(null);
    try {
      const res = await fetch('/api/arena/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loserId,
          winnerId,
          selectedElements: Array.from(selectedIds),
          evolutionType,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult({ id: data.id, title: data.title, generation: data.generation });
      setStep('success');
    } catch {
      setError('进化执行失败');
      setStep('plan');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8">
        {/* Header */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {t('arena.back')}
        </button>
        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <span className="w-1.5 h-5 bg-purple-500 rounded-full" />
          {t('arena.evolution')}
        </h2>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-6">
            {error}
          </div>
        )}

        {/* Loading */}
        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-400">分析进化方案中...</p>
          </div>
        )}

        {/* Plan display */}
        {step === 'plan' && plan && (
          <div className="space-y-6">
            {/* Select all toggle */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                已选 {selectedIds.size}/{plan.elements.length} 个元素
              </p>
              <button
                onClick={toggleAll}
                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>

            {/* Element list */}
            <div className="space-y-2">
              {plan.elements.map(el => (
                <ElementCard
                  key={el.id}
                  element={el}
                  checked={selectedIds.has(el.id)}
                  onToggle={() => toggleElement(el.id)}
                />
              ))}
            </div>

            {/* Evolution type selection */}
            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">进化方式</p>
              <div className="flex flex-wrap gap-2">
                {(['enhance', 'expand', 'style_merge'] as EvolutionType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => setEvolutionType(type)}
                    className={`px-4 py-2 rounded-xl text-sm border transition-all ${
                      evolutionType === type
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-300 ring-1 ring-purple-500/20'
                        : 'bg-[#141414] border-white/5 text-gray-400 hover:border-purple-500/20 hover:text-gray-300'
                    }`}
                  >
                    {t(`arena.evolutionType.${type}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Execute button */}
            <button
              onClick={handleExecute}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <EvolutionIcon className="w-4 h-4" />
              执行进化
            </button>
          </div>
        )}

        {/* Evolving progress */}
        {step === 'evolving' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-400">进化重构中...</p>
          </div>
        )}

        {/* Success */}
        {step === 'success' && result && (
          <div className="flex flex-col items-center justify-center py-16 space-y-6">
            <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center border border-purple-500/20">
              <EvolutionIcon className="w-8 h-8 text-purple-400" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-bold text-white">{result.title}</p>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-purple-500/10 border border-purple-500/20 text-purple-400">
                {t('arena.generation', { gen: result.generation })}
              </span>
            </div>
            <button
              onClick={onComplete}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-all"
            >
              {t('arena.back')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- 元素卡片 ---- */
function ElementCard({
  element,
  checked,
  onToggle,
}: {
  element: EvolutionElement;
  checked: boolean;
  onToggle: () => void;
}) {
  const color = CATEGORY_COLORS[element.category];
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        checked
          ? 'bg-purple-500/5 border-purple-500/20'
          : 'bg-[#141414] border-white/5 hover:border-white/10'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
          checked ? 'bg-purple-500 border-purple-500' : 'border-gray-600'
        }`}>
          {checked && <CheckIcon className="w-3 h-3 text-white" />}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-[10px] font-medium"
              style={{ backgroundColor: `${color}15`, color }}
            >
              {element.category}
            </span>
          </div>
          <p className="text-sm text-gray-200">{element.description}</p>
          <p className="text-xs text-gray-500">{element.expectedEffect}</p>
          <p className="text-xs text-gray-600 italic">{element.sourceDetail}</p>
        </div>
      </div>
    </button>
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

function EvolutionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3" /><path d="M18.5 13h-13" /><path d="m8 17-4-4 4-4" /><path d="m16 7 4 4-4 4" />
      <path d="M12 18v3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
