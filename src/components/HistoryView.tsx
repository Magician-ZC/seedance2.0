// 剧本历史视图 — 对战历史列表 + 进化谱系时间线 + 评分历史
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ScreenplayArenaHistory,
  BattleResult,
  EvolutionRecord,
  ArenaScoreResult,
  DimensionScores,
} from '../../server/src/arena-types';

interface HistoryViewProps {
  screenplayId: string;
  screenplayTitle: string;
  generation: number;
  onBack: () => void;
}

type HistoryTab = 'battles' | 'evolutions' | 'scores';

export default function HistoryView({ screenplayId, screenplayTitle, generation, onBack }: HistoryViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<HistoryTab>('battles');
  const [history, setHistory] = useState<ScreenplayArenaHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [screenplayId]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/arena/history/${screenplayId}`);
      if (res.ok) {
        const data: ScreenplayArenaHistory = await res.json();
        setHistory(data);
      }
    } catch { /* 静默处理 */ } finally {
      setLoading(false);
    }
  };

  const tabs: { key: HistoryTab; label: string; count: number }[] = [
    { key: 'battles', label: t('arena.battle'), count: history?.battles.length ?? 0 },
    { key: 'evolutions', label: t('arena.evolution'), count: history?.evolutions.length ?? 0 },
    { key: 'scores', label: t('arena.score'), count: history?.scores.length ?? 0 },
  ];

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

        {/* Title with generation badge */}
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-5 bg-orange-500 rounded-full" />
            {screenplayTitle}
          </h2>
          {generation > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 border border-purple-500/20 text-purple-400">
              {t('arena.generation', { gen: generation })}
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-[#1a1a1a]/40 p-1 rounded-xl border border-white/5 mb-6">
          {tabs.map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                tab === tb.key
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tb.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                tab === tb.key ? 'bg-white/10' : 'bg-white/5'
              }`}>
                {tb.count}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : !history ? (
          <EmptyBlock message="无法加载历史数据" />
        ) : tab === 'battles' ? (
          history.battles.length === 0
            ? <EmptyBlock message="暂无对战记录" />
            : <BattleHistory battles={history.battles} screenplayId={screenplayId} />
        ) : tab === 'evolutions' ? (
          history.evolutions.length === 0
            ? <EmptyBlock message="暂无进化记录" />
            : <EvolutionTimeline evolutions={history.evolutions} screenplayId={screenplayId} />
        ) : (
          history.scores.length === 0
            ? <EmptyBlock message="暂无评分记录" />
            : <ScoreHistory scores={history.scores} />
        )}
      </div>
    </div>
  );
}


/* ---- 空状态 ---- */
function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 bg-[#141414]/30 rounded-2xl border border-white/5 border-dashed">
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}

/* ---- 维度名称映射 ---- */
const DIMENSION_LABELS: Record<keyof DimensionScores, string> = {
  plotStructure: '剧情结构',
  characterization: '人物塑造',
  dialogueQuality: '对白质量',
  pacing: '节奏把控',
  creativity: '创意新颖度',
  commercialPotential: '商业潜力',
};

/* ---- 对战历史列表 ---- */
function BattleHistory({ battles, screenplayId }: { battles: BattleResult[]; screenplayId: string }) {
  return (
    <div className="space-y-3">
      {battles.map(b => {
        const isA = b.screenplayIdA === screenplayId;
        const opponentId = isA ? b.screenplayIdB : b.screenplayIdA;
        const myChange = isA ? b.eloChangeA : b.eloChangeB;
        const isWin = (isA && b.finalVerdict === 'a') || (!isA && b.finalVerdict === 'b');
        const isDraw = b.finalVerdict === 'draw';

        return (
          <BattleCard
            key={b.id}
            opponentId={opponentId}
            eloChange={myChange}
            isWin={isWin}
            isDraw={isDraw}
            dimensionResults={b.dimensionResults}
            createdAt={b.createdAt}
            isA={isA}
          />
        );
      })}
    </div>
  );
}

/* ---- 单条对战卡片 ---- */
function BattleCard({
  opponentId, eloChange, isWin, isDraw, dimensionResults, createdAt, isA,
}: {
  opponentId: string;
  eloChange: number;
  isWin: boolean;
  isDraw: boolean;
  dimensionResults: BattleResult['dimensionResults'];
  createdAt: number;
  isA: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const resultColor = isDraw ? 'text-gray-400' : isWin ? 'text-green-400' : 'text-red-400';
  const resultBg = isDraw ? 'bg-gray-500/10 border-gray-500/20' : isWin ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20';
  const resultText = isDraw ? '平' : isWin ? '胜' : '负';
  const eloSign = eloChange > 0 ? '+' : '';

  // 统计维度胜负
  const myWins = dimensionResults.filter(d =>
    (isA && d.winner === 'a') || (!isA && d.winner === 'b')
  ).length;
  const myLosses = dimensionResults.filter(d =>
    (isA && d.winner === 'b') || (!isA && d.winner === 'a')
  ).length;
  const draws = dimensionResults.filter(d => d.winner === 'draw').length;

  return (
    <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        {/* 胜负标记 */}
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${resultBg} ${resultColor}`}>
          {resultText}
        </span>

        {/* 对手 */}
        <span className="text-sm text-gray-300 flex-1 truncate">
          vs {opponentId.slice(0, 8)}...
        </span>

        {/* 维度胜负摘要 */}
        <span className="text-[10px] text-gray-500">
          {myWins}胜 {myLosses}负 {draws}平
        </span>

        {/* ELO 变化 */}
        <span className={`text-xs font-semibold ${eloChange > 0 ? 'text-green-400' : eloChange < 0 ? 'text-red-400' : 'text-gray-500'}`}>
          {eloSign}{eloChange}
        </span>

        {/* 时间 */}
        <span className="text-[10px] text-gray-600 w-20 text-right">
          {formatDate(createdAt)}
        </span>

        {/* 展开箭头 */}
        <ChevronIcon className={`w-3.5 h-3.5 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 展开的维度详情 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
          {dimensionResults.map(dim => {
            const myScore = isA ? dim.scoreA : dim.scoreB;
            const oppScore = isA ? dim.scoreB : dim.scoreA;
            const dimWin = (isA && dim.winner === 'a') || (!isA && dim.winner === 'b');
            const dimLoss = (isA && dim.winner === 'b') || (!isA && dim.winner === 'a');

            return (
              <div key={dim.dimension} className="flex items-center gap-3 text-xs">
                <span className="text-gray-500 w-20 truncate">
                  {DIMENSION_LABELS[dim.dimension] || dim.dimension}
                </span>
                <span className={`font-mono w-8 text-right ${dimWin ? 'text-green-400' : dimLoss ? 'text-red-400' : 'text-gray-400'}`}>
                  {myScore.toFixed(1)}
                </span>
                <span className="text-gray-600">vs</span>
                <span className="font-mono w-8 text-gray-400">{oppScore.toFixed(1)}</span>
                {dim.comment && (
                  <span className="text-gray-600 truncate flex-1">{dim.comment}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/* ---- 进化谱系时间线 ---- */
function EvolutionTimeline({ evolutions, screenplayId }: { evolutions: EvolutionRecord[]; screenplayId: string }) {
  // 按时间正序排列（从早到晚）
  const sorted = [...evolutions].sort((a, b) => a.createdAt - b.createdAt);

  const TYPE_LABELS: Record<string, string> = {
    enhance: '增强现有元素',
    expand: '扩展新内容',
    style_merge: '风格融合',
  };

  const CATEGORY_LABELS: Record<string, string> = {
    plot: '情节', character: '人物', dialogue: '对白',
    pacing: '节奏', scene: '场景', style: '风格',
  };

  return (
    <div className="relative pl-6">
      {/* 时间线竖线 */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-gradient-to-b from-purple-500/40 via-purple-500/20 to-transparent" />

      <div className="space-y-4">
        {sorted.map((evo) => {
          const isSource = evo.sourceScreenplayId === screenplayId;
          const isTarget = evo.targetScreenplayId === screenplayId;

          return (
            <div key={evo.id} className="relative">
              {/* 时间线节点 */}
              <div className="absolute -left-6 top-4 w-4 h-4 rounded-full border-2 border-purple-500/40 bg-[#0a0a0a] flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              </div>

              <div className="bg-[#141414] border border-white/5 rounded-xl p-4 space-y-3">
                {/* 头部：代数 + 类型 + 时间 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 border border-purple-500/20 text-purple-400">
                    Gen.{evo.generation}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-400">
                    {TYPE_LABELS[evo.evolutionType] || evo.evolutionType}
                  </span>
                  {isSource && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      原始版本
                    </span>
                  )}
                  {isTarget && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-green-500/10 text-green-400 border border-green-500/20">
                      进化产物
                    </span>
                  )}
                  <span className="text-[10px] text-gray-600 ml-auto">
                    {formatDate(evo.createdAt)}
                  </span>
                </div>

                {/* 进化关系 */}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="truncate">{evo.sourceScreenplayId.slice(0, 8)}...</span>
                  <EvolutionArrowIcon className="w-4 h-4 text-purple-500/60 flex-shrink-0" />
                  <span className="truncate">{evo.targetScreenplayId.slice(0, 8)}...</span>
                  <span className="text-gray-600 ml-1">← 吸收自</span>
                  <span className="truncate">{evo.winnerScreenplayId.slice(0, 8)}...</span>
                </div>

                {/* 吸收的元素 */}
                {Array.isArray(evo.absorbedElements) && evo.absorbedElements.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {evo.absorbedElements.map((el, i) => {
                      const label = typeof el === 'string' ? el : (CATEGORY_LABELS[(el as any).category] || (el as any).category);
                      return (
                        <span key={i} className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-400">
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ---- 评分历史 ---- */
function ScoreHistory({ scores }: { scores: ArenaScoreResult[] }) {
  return (
    <div className="space-y-3">
      {scores.map(s => (
        <div key={s.id} className="bg-[#141414] border border-white/5 rounded-xl p-4 space-y-3">
          {/* 头部 */}
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              s.mode === 'panel'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : 'bg-white/5 text-gray-400'
            }`}>
              {s.mode === 'panel' ? '评审团' : '单角色'}
            </span>
            {s.skippedRoles.length > 0 && (
              <span className="text-[10px] text-yellow-500">
                跳过: {s.skippedRoles.join(', ')}
              </span>
            )}
            <span className="text-[10px] text-gray-600 ml-auto">
              {formatDate(s.createdAt)}
            </span>
          </div>

          {/* 六维度分数条 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(Object.keys(DIMENSION_LABELS) as (keyof DimensionScores)[]).map(key => {
              const val = s.finalScores[key] ?? 0;
              const pct = (val / 10) * 100;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-16 truncate">
                    {DIMENSION_LABELS[key]}
                  </span>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-orange-500/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono w-6 text-right">
                    {val.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- 工具函数 ---- */
function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/* ---- 内联图标 ---- */
function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
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

function EvolutionArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}
