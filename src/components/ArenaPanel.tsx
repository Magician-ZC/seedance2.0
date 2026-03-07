import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ScoreView from './ScoreView';
import BattleView from './BattleView';
import EvolutionView from './EvolutionView';
import TournamentView from './TournamentView';
import LeaderboardView from './LeaderboardView';
import HistoryView from './HistoryView';
import LoopView from './LoopView';
import LLMStatsView from './LLMStatsView';

// 角斗场剧本信息类型
interface ArenaScreenplayInfo {
  id: string;
  title: string;
  episodeCount: number;
  elo: number;
  latestScore?: {
    plotStructure: number;
    characterization: number;
    dialogueQuality: number;
    pacing: number;
    creativity: number;
    commercialPotential: number;
  };
  generation: number;
  createdAt: number;
}

// 子视图类型
type ArenaView = 'home' | 'score' | 'battle' | 'tournament' | 'leaderboard' | 'history' | 'evolution' | 'loop' | 'stats';

export default function ArenaPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<ArenaView>('home');
  const [screenplays, setScreenplays] = useState<ArenaScreenplayInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScreenplayId, setSelectedScreenplayId] = useState<string | null>(null);
  // 对战进化相关状态
  const [battleLoserId, setBattleLoserId] = useState<string | null>(null);
  const [battleWinnerId, setBattleWinnerId] = useState<string | null>(null);
  const [battleId, setBattleId] = useState<string | null>(null);

  useEffect(() => {
    fetchScreenplays();
  }, []);

  const fetchScreenplays = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/arena/screenplays');
      const data = await res.json();
      if (Array.isArray(data?.screenplays)) {
        setScreenplays(data.screenplays);
      }
    } catch {
      // 静默处理错误
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (target: ArenaView, screenplayId?: string) => {
    if (screenplayId) setSelectedScreenplayId(screenplayId);
    setView(target);
  };

  const goHome = () => {
    setView('home');
    setSelectedScreenplayId(null);
  };

  // 评分视图
  if (view === 'score') {
    return <ScoreView screenplays={screenplays} onBack={goHome} />;
  }

  // 对战视图
  if (view === 'battle') {
    return (
      <BattleView
        screenplays={screenplays}
        onBack={goHome}
        onEvolve={(loserId, winnerId, bId) => {
          setBattleLoserId(loserId);
          setBattleWinnerId(winnerId);
          setBattleId(bId);
          navigateTo('evolution');
        }}
      />
    );
  }

  // 进化视图
  if (view === 'evolution' && battleLoserId && battleWinnerId && battleId) {
    return (
      <EvolutionView
        loserId={battleLoserId}
        winnerId={battleWinnerId}
        battleId={battleId}
        onBack={goHome}
        onComplete={() => { fetchScreenplays(); goHome(); }}
      />
    );
  }

  // 锦标赛视图
  if (view === 'tournament') {
    return <TournamentView screenplays={screenplays} onBack={goHome} />;
  }

  // 排行榜视图
  if (view === 'leaderboard') {
    return <LeaderboardView onBack={goHome} />;
  }

  // 历史视图
  if (view === 'history' && selectedScreenplayId) {
    const sp = screenplays.find(s => s.id === selectedScreenplayId);
    return (
      <HistoryView
        screenplayId={selectedScreenplayId}
        screenplayTitle={sp?.title || '未命名剧本'}
        generation={sp?.generation || 0}
        onBack={goHome}
      />
    );
  }

  // 闭环迭代记录视图
  if (view === 'loop' && selectedScreenplayId) {
    return (
      <LoopView
        projectId={selectedScreenplayId}
        onBack={goHome}
      />
    );
  }

  // LLM调用统计视图
  if (view === 'stats' && selectedScreenplayId) {
    return (
      <LLMStatsView
        projectId={selectedScreenplayId}
        onBack={goHome}
      />
    );
  }

  // 其他子视图占位组件（后续任务实现）
  if (view !== 'home') {
    return (
      <SubViewPlaceholder
        view={view}
        label={getViewLabel(view, t)}
        screenplayId={selectedScreenplayId}
        onBack={goHome}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white flex items-center gap-3">
            <span className="w-1.5 h-6 bg-orange-500 rounded-full" />
            {t('arena.title')}
          </h1>
          <button
            onClick={() => navigateTo('leaderboard')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-white/5 border border-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
          >
            <TrophyIcon className="w-4 h-4 text-yellow-400" />
            {t('arena.leaderboard')}
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 bg-[#1a1a1a]/40 p-4 rounded-2xl border border-white/5 backdrop-blur-sm">
          <button
            onClick={() => navigateTo('score')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
          >
            <StarIcon className="w-4 h-4" />
            {t('arena.score')}
          </button>
          <button
            onClick={() => navigateTo('battle')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
          >
            <CrossedSwordsIcon className="w-4 h-4" />
            {t('arena.battle')}
          </button>
          <button
            onClick={() => navigateTo('tournament')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20 transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
          >
            <TrophyIcon className="w-4 h-4" />
            {t('arena.tournament')}
          </button>
        </div>

        {/* Screenplay List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-gray-500 text-sm">{t('common.loading')}</span>
          </div>
        ) : screenplays.length === 0 ? (
          <EmptyState message={t('arena.empty')} />
        ) : (
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {screenplays.map((sp) => (
                <ScreenplayCard
                  key={sp.id}
                  screenplay={sp}
                  onClick={() => navigateTo('history', sp.id)}
                  onLoopClick={() => navigateTo('loop', sp.id)}
                  onStatsClick={() => navigateTo('stats', sp.id)}
                  t={t}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}


/* ---- 获取子视图标签 ---- */
function getViewLabel(view: ArenaView, t: (key: string) => string): string {
  const map: Record<ArenaView, string> = {
    home: t('arena.title'),
    score: t('arena.score'),
    battle: t('arena.battle'),
    tournament: t('arena.tournament'),
    leaderboard: t('arena.leaderboard'),
    history: t('arena.history'),
    evolution: t('arena.evolution'),
    loop: t('loop.title'),
    stats: t('llmStats.title'),
  };
  return map[view] || view;
}

/* ---- 子视图占位组件 ---- */
function SubViewPlaceholder({ view, label, screenplayId: _screenplayId, onBack }: { view: string; label: string; screenplayId?: string | null; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {t('arena.back')}
        </button>
        <div className="flex flex-col items-center justify-center py-20 bg-[#141414]/30 rounded-2xl border border-white/5 border-dashed">
          <p className="text-gray-500 text-sm">{label}（{view} — 开发中）</p>
        </div>
      </div>
    </div>
  );
}

/* ---- 空状态 ---- */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-[#141414]/30 rounded-2xl border border-white/5 border-dashed">
      <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-4 shadow-inner">
        <CrossedSwordsIcon className="w-6 h-6 text-gray-600" />
      </div>
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}

/* ---- 剧本卡片 ---- */
function ScreenplayCard({
  screenplay,
  onClick,
  onLoopClick,
  onStatsClick,
  t,
}: {
  screenplay: ArenaScreenplayInfo;
  onClick: () => void;
  onLoopClick?: () => void;
  onStatsClick?: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div
      onClick={onClick}
      className="group bg-[#141414] border border-white/5 rounded-2xl overflow-hidden hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-900/10 transition-all duration-300 cursor-pointer flex flex-col h-full"
    >
      {/* 顶部区域：雷达图缩略图或占位 */}
      <div className="aspect-video bg-[#111] flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        {screenplay.latestScore ? (
          <MiniRadar scores={screenplay.latestScore} />
        ) : (
          <CrossedSwordsIcon className="w-10 h-10 text-orange-500/20 group-hover:scale-110 transition-transform duration-500" />
        )}
        {/* Generation badge */}
        {screenplay.generation > 0 && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 border border-purple-500/20 text-purple-400 backdrop-blur-sm">
              {t('arena.generation', { gen: screenplay.generation })}
            </span>
          </div>
        )}
        {/* ELO badge */}
        <div className="absolute top-2 right-2">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 backdrop-blur-sm">
            ELO {screenplay.elo}
          </span>
        </div>
      </div>

      {/* 信息区域 */}
      <div className="p-4 flex-1 flex flex-col">
        <p className="text-sm text-gray-200 font-semibold line-clamp-1 mb-2">{screenplay.title}</p>
        <div className="flex items-center gap-2 mt-auto text-[10px] text-gray-500 font-mono">
          <span className="bg-white/5 px-1.5 py-0.5 rounded">
            {t('arena.episodes', { count: screenplay.episodeCount })}
          </span>
        </div>
        <div className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
          <span>{new Date(screenplay.createdAt).toLocaleDateString()}</span>
          {onLoopClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onLoopClick(); }}
              className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
              title={t('loop.title')}
            >
              🔄 {t('loop.title')}
            </button>
          )}
          {onStatsClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onStatsClick(); }}
              className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
              title={t('llmStats.title')}
            >
              📊 {t('llmStats.title')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- 迷你雷达图（简易 SVG 可视化） ---- */
function MiniRadar({ scores }: { scores: NonNullable<ArenaScreenplayInfo['latestScore']> }) {
  const dims = [
    scores.plotStructure,
    scores.characterization,
    scores.dialogueQuality,
    scores.pacing,
    scores.creativity,
    scores.commercialPotential,
  ];
  const cx = 50, cy = 50, r = 35;
  const points = dims.map((val, i) => {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const ratio = val / 10;
    return `${cx + r * ratio * Math.cos(angle)},${cy + r * ratio * Math.sin(angle)}`;
  }).join(' ');

  // 背景网格
  const gridPoints = [1, 0.6, 0.3].map(scale =>
    Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      return `${cx + r * scale * Math.cos(angle)},${cy + r * scale * Math.sin(angle)}`;
    }).join(' ')
  );

  return (
    <svg viewBox="0 0 100 100" className="w-20 h-20 opacity-60 group-hover:opacity-80 transition-opacity">
      {gridPoints.map((gp, i) => (
        <polygon key={i} points={gp} fill="none" stroke="white" strokeOpacity={0.08} strokeWidth={0.5} />
      ))}
      <polygon points={points} fill="rgba(249,115,22,0.2)" stroke="rgba(249,115,22,0.6)" strokeWidth={1} />
    </svg>
  );
}

/* ---- 内联图标 ---- */
function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function CrossedSwordsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="M13 19l6-6" /><path d="M16 16l4 4" />
      <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" /><path d="M11 19l-6-6" /><path d="M8 16l-4 4" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
    </svg>
  );
}
