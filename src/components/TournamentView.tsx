// 锦标赛视图 — 赛制配置、WebSocket 实时进度、淘汰赛对阵图/循环赛表、冠军展示
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { wsService } from '../services/wsService';
import type { WsMessage } from '../services/wsService';
import type {
  ArenaScreenplayInfo,
  TournamentResult,
  TournamentRound,
  TournamentMatch,
} from '../../server/src/arena-types';

interface TournamentViewProps {
  screenplays: ArenaScreenplayInfo[];
  onBack: () => void;
}

type Step = 'config' | 'running' | 'completed' | 'error';
type Format = 'elimination' | 'round-robin';

export default function TournamentView({ screenplays, onBack }: TournamentViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('config');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Format>('elimination');
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [result, setResult] = useState<TournamentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // 清理 WebSocket 订阅
  useEffect(() => {
    return () => { unsubRef.current?.(); };
  }, []);

  const toggleScreenplay = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleStart = async () => {
    if (selectedIds.size < 3) return;
    setStarting(true);
    setError(null);
    setProgressLog([]);
    setResult(null);

    try {
      const res = await fetch('/api/arena/tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenplayIds: [...selectedIds], format }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { taskId } = await res.json();

      setStep('running');
      setStarting(false);

      // 订阅 WebSocket 进度
      unsubRef.current = wsService.subscribe(taskId, (msg: WsMessage) => {
        if (msg.type === 'task_progress') {
          if (msg.data.progress) {
            setProgressLog(prev => [...prev, msg.data.progress!]);
          }
        } else if (msg.type === 'task_done') {
          if (msg.data.result) {
            setResult(msg.data.result as unknown as TournamentResult);
          }
          setStep('completed');
          unsubRef.current?.();
        } else if (msg.type === 'task_error') {
          setError(msg.data.error || 'Unknown error');
          setStep('error');
          unsubRef.current?.();
        }
      });
    } catch {
      setError('Failed to start tournament');
      setStep('error');
      setStarting(false);
    }
  };

  const titleMap = new Map(screenplays.map(sp => [sp.id, sp.title]));
  const getTitle = (id: string) => titleMap.get(id) || id.slice(0, 8);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8">
        {/* Header */}
        <button
          onClick={step === 'config' ? onBack : () => setStep('config')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {t('arena.back')}
        </button>
        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <span className="w-1.5 h-5 bg-purple-500 rounded-full" />
          {t('arena.tournament')}
        </h2>

        {/* Step 1: Config */}
        {step === 'config' && (
          <ConfigStep
            screenplays={screenplays}
            selectedIds={selectedIds}
            format={format}
            onToggle={toggleScreenplay}
            onFormatChange={setFormat}
            onStart={handleStart}
            starting={starting}
            t={t}
          />
        )}

        {/* Step 2: Running */}
        {step === 'running' && (
          <RunningStep progressLog={progressLog} t={t} />
        )}

        {/* Step 3: Completed */}
        {step === 'completed' && result && (
          <CompletedStep result={result} getTitle={getTitle} t={t} />
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
            <button
              onClick={() => setStep('config')}
              className="px-5 py-2 rounded-xl text-sm bg-white/5 border border-white/5 text-gray-300 hover:bg-white/10 transition-all"
            >
              {t('arena.back')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


/* ---- Step 1: 赛制配置 ---- */
function ConfigStep({
  screenplays, selectedIds, format, onToggle, onFormatChange, onStart, starting, t,
}: {
  screenplays: ArenaScreenplayInfo[];
  selectedIds: Set<string>;
  format: Format;
  onToggle: (id: string) => void;
  onFormatChange: (f: Format) => void;
  onStart: () => void;
  starting: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const canStart = selectedIds.size >= 3 && !starting;

  return (
    <div className="space-y-6">
      {/* 赛制选择 */}
      <div className="space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">赛制</p>
        <div className="flex gap-3">
          <RadioButton
            label="淘汰赛"
            selected={format === 'elimination'}
            onClick={() => onFormatChange('elimination')}
          />
          <RadioButton
            label="循环赛"
            selected={format === 'round-robin'}
            onClick={() => onFormatChange('round-robin')}
          />
        </div>
      </div>

      {/* 剧本选择 */}
      <div className="space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">
          {t('arena.selectScreenplay')} ({selectedIds.size} / {screenplays.length}，至少 3 个)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
          {screenplays.map(sp => {
            const checked = selectedIds.has(sp.id);
            return (
              <button
                key={sp.id}
                onClick={() => onToggle(sp.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                  checked
                    ? 'bg-purple-500/10 border-purple-500/30 ring-1 ring-purple-500/20'
                    : 'bg-[#141414] border-white/5 hover:border-purple-500/20 hover:bg-[#1a1a1a]'
                }`}
              >
                <div className={`w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                  checked ? 'bg-purple-500 border-purple-500' : 'border-gray-600'
                }`}>
                  {checked && <CheckIcon className="w-3 h-3 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
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
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 开始按钮 */}
      <button
        onClick={onStart}
        disabled={!canStart}
        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {starting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {t('arena.startTournament')}
      </button>
    </div>
  );
}


/* ---- Step 2: 进行中 ---- */
function RunningStep({ progressLog, t }: { progressLog: string[]; t: (key: string) => string }) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progressLog.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        <p className="text-sm text-gray-300">{t('arena.tournament')} — 进行中...</p>
      </div>

      {/* 进度日志 */}
      <div className="bg-[#141414] border border-white/5 rounded-xl p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
        {progressLog.length === 0 ? (
          <p className="text-xs text-gray-500">等待对战开始...</p>
        ) : (
          <div className="space-y-1.5">
            {progressLog.map((msg, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-gray-600 flex-shrink-0 font-mono w-6 text-right">{i + 1}.</span>
                <span className="text-gray-400">{msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}


/* ---- Step 3: 完成 ---- */
function CompletedStep({
  result, getTitle, t,
}: {
  result: TournamentResult;
  getTitle: (id: string) => string;
  t: (key: string) => string;
}) {
  const champion = result.championId ? getTitle(result.championId) : null;

  return (
    <div className="space-y-8">
      {/* 冠军展示 */}
      {champion && (
        <div className="p-6 rounded-2xl bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border border-yellow-500/20 text-center space-y-2">
          <p className="text-xs text-yellow-400/60 uppercase tracking-wider">{t('arena.champion')}</p>
          <p className="text-2xl font-bold text-white">🏆 {champion}</p>
        </div>
      )}

      {/* 赛程详情 */}
      {result.format === 'elimination' ? (
        <EliminationBracket rounds={result.rounds} getTitle={getTitle} t={t} />
      ) : (
        <RoundRobinTable rounds={result.rounds} screenplayIds={result.screenplayIds} getTitle={getTitle} t={t} />
      )}
    </div>
  );
}


/* ---- 淘汰赛对阵图 ---- */
function EliminationBracket({
  rounds, getTitle, t,
}: {
  rounds: TournamentRound[];
  getTitle: (id: string) => string;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-6">
      {rounds.map(round => (
        <div key={round.roundNumber} className="space-y-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
            Round {round.roundNumber}
          </p>
          <div className="space-y-2">
            {round.matches.map((match, i) => (
              <MatchCard key={i} match={match} getTitle={getTitle} t={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ---- 循环赛结果表 ---- */
function RoundRobinTable({
  rounds, screenplayIds, getTitle, t,
}: {
  rounds: TournamentRound[];
  screenplayIds: string[];
  getTitle: (id: string) => string;
  t: (key: string) => string;
}) {
  // 统计每个剧本的胜/负/平
  const stats = new Map<string, { wins: number; losses: number; draws: number }>();
  screenplayIds.forEach(id => stats.set(id, { wins: 0, losses: 0, draws: 0 }));

  const allMatches: TournamentMatch[] = rounds.flatMap(r => r.matches);
  allMatches.forEach(m => {
    if (!m.screenplayIdB || !m.winner) return;
    if (m.winner === m.screenplayIdA) {
      stats.get(m.screenplayIdA)!.wins++;
      stats.get(m.screenplayIdB)!.losses++;
    } else if (m.winner === m.screenplayIdB) {
      stats.get(m.screenplayIdB)!.wins++;
      stats.get(m.screenplayIdA)!.losses++;
    } else {
      // draw
      stats.get(m.screenplayIdA)!.draws++;
      stats.get(m.screenplayIdB)!.draws++;
    }
  });

  // 按胜场降序排列
  const sorted = [...stats.entries()].sort((a, b) => b[1].wins - a[1].wins);

  return (
    <div className="space-y-6">
      {/* 排名表 */}
      <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs text-gray-500">
              <th className="text-left px-4 py-3">#</th>
              <th className="text-left px-4 py-3">剧本</th>
              <th className="text-center px-4 py-3">{t('arena.win')}</th>
              <th className="text-center px-4 py-3">{t('arena.loss')}</th>
              <th className="text-center px-4 py-3">{t('arena.draw')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(([id, s], i) => (
              <tr key={id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-gray-500 font-mono">
                  {i === 0 ? '🏆' : i + 1}
                </td>
                <td className="px-4 py-3 text-gray-200 font-medium line-clamp-1 max-w-[200px]">
                  {getTitle(id)}
                </td>
                <td className="px-4 py-3 text-center text-green-400">{s.wins}</td>
                <td className="px-4 py-3 text-center text-red-400">{s.losses}</td>
                <td className="px-4 py-3 text-center text-gray-400">{s.draws}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 对战详情 */}
      <div className="space-y-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">对战详情</p>
        <div className="space-y-2">
          {allMatches.map((match, i) => (
            <MatchCard key={i} match={match} getTitle={getTitle} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}


/* ---- 单场对战卡片 ---- */
function MatchCard({
  match, getTitle, t,
}: {
  match: TournamentMatch;
  getTitle: (id: string) => string;
  t: (key: string) => string;
}) {
  const isBye = !match.screenplayIdB;
  const titleA = getTitle(match.screenplayIdA);
  const titleB = match.screenplayIdB ? getTitle(match.screenplayIdB) : '轮空';

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-[#141414] border border-white/5">
      {/* Side A */}
      <div className={`flex-1 text-right text-sm ${
        match.winner === match.screenplayIdA ? 'text-green-400 font-semibold' : 'text-gray-400'
      }`}>
        <span className="line-clamp-1">{titleA}</span>
      </div>

      {/* VS / Result */}
      <div className="flex-shrink-0 w-16 text-center">
        {isBye ? (
          <span className="text-[10px] text-gray-600">BYE</span>
        ) : match.winner ? (
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-500">
            {match.winner === match.screenplayIdA ? `A ${t('arena.win')}` : `B ${t('arena.win')}`}
          </span>
        ) : (
          <span className="text-xs text-gray-600">vs</span>
        )}
      </div>

      {/* Side B */}
      <div className={`flex-1 text-left text-sm ${
        match.winner === match.screenplayIdB ? 'text-green-400 font-semibold' : isBye ? 'text-gray-600 italic' : 'text-gray-400'
      }`}>
        <span className="line-clamp-1">{titleB}</span>
      </div>
    </div>
  );
}


/* ---- 单选按钮 ---- */
function RadioButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all ${
        selected
          ? 'bg-purple-500/10 border-purple-500/30 text-white ring-1 ring-purple-500/20'
          : 'bg-[#141414] border-white/5 text-gray-400 hover:border-purple-500/20 hover:bg-[#1a1a1a]'
      }`}
    >
      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
        selected ? 'border-purple-500' : 'border-gray-600'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
      </div>
      {label}
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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
