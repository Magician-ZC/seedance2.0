// 排行榜视图 — ELO 排行榜列表、排名动画效果
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeaderboardEntry } from '../../server/src/arena-types';

interface LeaderboardViewProps {
  onBack: () => void;
}

export default function LeaderboardView({ onBack }: LeaderboardViewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/arena/leaderboard');
        const data = await res.json();
        if (Array.isArray(data)) setEntries(data);
      } catch {
        // 静默处理
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rankBadge = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
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
          <span className="w-1.5 h-5 bg-yellow-500 rounded-full" />
          {t('arena.leaderboard')}
        </h2>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-gray-500 text-sm">{t('common.loading')}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-[#141414]/30 rounded-2xl border border-white/5 border-dashed">
            <p className="text-gray-500 text-sm">{t('arena.empty')}</p>
          </div>
        ) : (
          <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-gray-500">
                  <th className="text-center px-4 py-3 w-16">#</th>
                  <th className="text-left px-4 py-3">剧本</th>
                  <th className="text-center px-4 py-3">{t('arena.elo')}</th>
                  <th className="text-center px-4 py-3">{t('arena.win')}</th>
                  <th className="text-center px-4 py-3">{t('arena.loss')}</th>
                  <th className="text-center px-4 py-3">{t('arena.draw')}</th>
                  <th className="text-center px-4 py-3">{t('arena.winRate')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const rank = i + 1;
                  return (
                    <tr
                      key={entry.screenplayId}
                      className="border-b border-white/5 last:border-0 animate-fade-in-row"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <td className="px-4 py-3 text-center text-lg">
                        {rank <= 3 ? (
                          <span>{rankBadge(rank)}</span>
                        ) : (
                          <span className="text-gray-500 text-sm font-mono">{rank}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-200 font-medium line-clamp-1 max-w-[260px]">
                        {entry.title}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-yellow-400 font-semibold font-mono">{entry.elo}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-green-400">{entry.wins}</td>
                      <td className="px-4 py-3 text-center text-red-400">{entry.losses}</td>
                      <td className="px-4 py-3 text-center text-gray-400">{entry.draws}</td>
                      <td className="px-4 py-3 text-center text-orange-400 font-mono">
                        {(entry.winRate * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 交错淡入动画 */}
      <style>{`
        @keyframes fadeInRow {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-row {
          opacity: 0;
          animation: fadeInRow 0.35s ease-out forwards;
        }
      `}</style>
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
