// 剧本创建向导组件 - 基于 short-drama 方法论的多步骤创作流程
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ForceGraph2D from 'react-force-graph-2d';
import { CloseIcon, ArrowLeftIcon, SparkleIcon, CheckIcon, DownloadIcon, BookIcon, FilmIcon } from './Icons';
import { createZipBlob } from '../utils/zip';

// ============================================================
// 类型定义（与后端对齐）
// ============================================================

interface ArenaConfig {
  groupCount: number;
  membersPerGroup: number;
  strictness: 'standard' | 'strict' | 'extreme';
  concurrency: number;
  passScore: number;
}

interface ScreenplayConfig {
  genres: string[];
  audience: '男频' | '女频' | '全年龄';
  tone: string;
  endingType: string;
  totalEpisodes: number;
  language: 'zh-CN' | 'en-US';
  mode: 'domestic' | 'overseas';
  customPrompt?: string;
  agentId?: string;
  referenceNovel?: string;
  useCharacterPool?: boolean;
  useTimeline?: boolean;
  arenaMode?: boolean;
  arenaConfig?: ArenaConfig;
}

interface CreativePlan {
  titleOptions: Array<{ title: string; description: string }>;
  setting: { era: string; location: string; socialEnv: string; classRelation: string };
  storyLine: string;
  coreConflict: string;
  fourActs: {
    act1: { episodeRange: string; coreEvents: string[]; relationships: string };
    act2: { episodeRange: string; conflicts: string[]; turningPoints: string[] };
    act3: { episodeRange: string; climax: string; turningPoints: string[] };
    act4: { episodeRange: string; ending: string; themeElevation: string };
  };
  rhythmWave: string;
  paywallPlan: Array<{ episode: number; type: string; suspense: string }>;
  satisfactionMatrix: Record<string, number>;
  endingDesign: { mainLine: string; romanceLine: string; foreshadowRecovery: string };
}

interface ScreenplayCharacter {
  id: string; name: string; age: string; appearance: string;
  personality: string[]; publicIdentity: string; realIdentity: string;
  motivation: string; conflictPoint: string; satisfactionRole: string;
  catchphrase: string; arc: string; villainLayer?: number;
}

interface CharacterRelationship { from: string; to: string; relation: string; }

interface CharacterDesign {
  characters: ScreenplayCharacter[];
  relationships: CharacterRelationship[];
  romanceLine: Array<{ episode: number; event: string }>;
  villainSystem: { layer1: ScreenplayCharacter[]; layer2: ScreenplayCharacter[]; layer3: ScreenplayCharacter[]; layer4: ScreenplayCharacter[] };
}

interface EpisodeDirectoryItem {
  number: number; title: string; summary: string;
  hookType: string; mark: '' | '🔥' | '💰'; act: string; phase: string;
}

interface SceneBlock {
  sceneNumber: number; location: string; characters: string[];
  description: string;
  dialogues: Array<{ character: string; direction: string; line: string }>;
  musicCue?: string;
}

interface EpisodeScript {
  number: number; title: string; keywords: string[];
  satisfactionType: string; previousRecap: string;
  scenes: SceneBlock[]; endHook: string; nextPreview: string;
  phase: string; hookType: string; mark: string;
}

interface ReviewScore {
  rhythm: { score: number; comment: string };
  satisfaction: { score: number; comment: string };
  dialogue: { score: number; comment: string };
  format: { score: number; comment: string };
  continuity: { score: number; comment: string };
  total: number;
  issues: Array<{ severity: string; description: string; suggestion: string }>;
}

interface SubmissionMaterials {
  episodeOutline: string;
  ecard: string;
  characterBios: string;
  scriptSynopsis: string;
}

interface ScreenplayProject {
  id: string;
  status: string;
  config: ScreenplayConfig;
  creativePlan?: CreativePlan;
  characterDesign?: CharacterDesign;
  episodeDirectory?: EpisodeDirectoryItem[];
  episodes: EpisodeScript[];
  reviews: Record<number, ReviewScore>;
  selectedTitle?: string;
  simulationLogs?: string[];
  submissionMaterials?: SubmissionMaterials;
  createdAt: number;
  updatedAt: number;
}

interface GenreItem { key: string; name: string; desc: string; audience: string; }

interface ScreenplayCreatorProps {
  onClose: () => void;
  onMinimize?: () => void;
  onProjectCreated?: (projectId: string) => void;
  onStatusChange?: (status: { step: string; stepLabel: string; loading: boolean; projectTitle?: string }) => void;
  resumeProjectId?: string | null;
  hidden?: boolean;
}

type Step = 'config' | 'plan' | 'characters' | 'directory' | 'writing' | 'review' | 'submission';
const STEPS: Step[] = ['config', 'plan', 'characters', 'directory', 'writing', 'review', 'submission'];

const STEP_LABELS: Record<Step, { zh: string; en: string }> = {
  config: { zh: '选题定位', en: 'Setup' },
  plan: { zh: '创作方案', en: 'Plan' },
  characters: { zh: '角色开发', en: 'Characters' },
  directory: { zh: '分集目录', en: 'Directory' },
  writing: { zh: '分集撰写', en: 'Writing' },
  review: { zh: '质量自检', en: 'Review' },
  submission: { zh: '投稿', en: 'Submit' },
};

const TONES = ['爽燃', '甜虐', '搞笑', '暗黑', '温情', '甜宠'];
const ENDINGS = [
  { value: 'HE', label: '大团圆 (HE)' },
  { value: 'BE', label: '悲剧 (BE)' },
  { value: 'OE', label: '开放式 (OE)' },
  { value: '反转式', label: '反转式' },
];

// ============================================================
// WebSocket 进度监听 Hook
// ============================================================

function useTaskProgress(taskId: string | null, onDone: (signal?: string) => void) {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // taskId 变化时始终清除旧日志
    setLogs([]); setError('');
    if (!taskId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    let done = false;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.taskId === taskId) {
          const status = msg.data?.status || msg.status;
          const progressText = msg.data?.progress || msg.progress;
          const errorText = msg.data?.error || msg.error;
          if (status === 'processing' && progressText) {
            setLogs(prev => [...prev, progressText]);
            // 每完成一集或竞技阶段完成时实时刷新项目数据
            if (progressText.includes('撰写完成') || progressText.includes('已完成') ||
                progressText.includes('方案已选出') || progressText.includes('角色开发完成') ||
                progressText.includes('Top 5已选出') || progressText.includes('竞技完成') ||
                progressText.includes('阶段2开始') || progressText.includes('阶段3开始') ||
                progressText.includes('阶段4开始') || progressText.includes('竞技分集撰写完成')) {
              onDoneRef.current('refresh');
            }
          } else if (status === 'done') { done = true; setLogs(prev => [...prev, '✅ 完成']); onDoneRef.current(); ws.close(); }
          else if (status === 'error') { setError(errorText || '处理失败'); onDoneRef.current(); ws.close(); }
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => setError('WebSocket 连接失败');
    ws.onclose = () => { if (!done) onDoneRef.current(); };

    return () => { done = true; ws.close(); };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { logs, error };
}

function ProgressLog({ logs }: { logs: string[] }) {
  const filteredLogs = logs.filter(l => !l.startsWith('[SIM]'));
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [filteredLogs.length]);
  if (filteredLogs.length === 0) return null;
  return (
    <div className="rounded-xl bg-[#0d0d0d] border border-blue-500/20 overflow-hidden shadow-lg animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-500/10 border-b border-blue-500/10">
        <span className="text-xs font-bold text-blue-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
          实时创作日志
        </span>
        <span className="text-[10px] text-blue-300/60 font-mono">{filteredLogs.length} ops</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar p-4 space-y-2 font-mono">
        {filteredLogs.map((log, i) => (
          <div key={i} className="text-xs text-gray-400 leading-relaxed flex gap-3">
            <span className="text-gray-700 select-none">{String(i + 1).padStart(2, '0')}</span>
            <span className={log.includes('✅') ? 'text-green-400' : ''}>{log}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ============================================================
// 世界观模拟实况面板 - 力导向气泡图 (react-force-graph-2d)
// ============================================================

interface SimEvent { type: string; [key: string]: unknown }
interface SimInteractionUI { p: string[]; t: string; d: string; tension: number; timeline?: string }

function parseSimEvents(logs: string[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (const l of logs) {
    if (!l.startsWith('[SIM]')) continue;
    try { out.push(JSON.parse(l.slice(5))); } catch { /* skip */ }
  }
  return out;
}

function charHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return ((h % 360) + 360) % 360;
}
function charColor(name: string) { return `hsl(${charHue(name)},70%,60%)`; }

const LINK_COLORS: Record<string, string> = {
  '冲突': '#ef4444', '对抗': '#ef4444', '合作': '#3b82f6',
  '暧昧': '#ec4899', '依赖': '#eab308', '利用': '#f97316',
};
const TYPE_EMOJI: Record<string, string> = {
  '冲突': '⚔️', '对抗': '⚔️', '合作': '🤝', '暧昧': '💕', '依赖': '🔗', '利用': '🎭',
};

interface CharEvent {
  round: number | string; type: string; partner: string;
  description: string; tension: number; timeline: string;
}

function buildCharData(events: SimEvent[]) {
  const names: string[] = [];
  const startEvt = events.find(e => e.type === 'start');
  if (startEvt?.characters) names.push(...(startEvt.characters as string[]));
  const charMap = new Map<string, CharEvent[]>();
  const links: Array<{ source: string; target: string; type: string; tension: number }> = [];
  for (const e of events) {
    const inters = e.interactions as SimInteractionUI[] | undefined;
    if (!inters || !Array.isArray(inters)) continue;
    const round = e.type === 'cross_result' ? '交叉' : (e.round as number);
    for (const it of inters) {
      if (!it.p || it.p.length < 2) continue;
      links.push({ source: it.p[0], target: it.p[1], type: it.t, tension: it.tension });
      for (const n of it.p) {
        if (!names.includes(n)) names.push(n);
        if (!charMap.has(n)) charMap.set(n, []);
        charMap.get(n)!.push({
          round, type: it.t, partner: it.p.filter(x => x !== n).join('、'),
          description: it.d, tension: it.tension, timeline: it.timeline || '发展',
        });
      }
    }
  }
  for (const n of names) if (!charMap.has(n)) charMap.set(n, []);
  return { names, charMap, links };
}

function SimulationPanel({ logs }: { logs: string[] }) {
  const events = parseSimEvents(logs);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const graphRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  if (events.length === 0) return null;

  const startEvt = events.find(e => e.type === 'start');
  const totalRounds = (startEvt?.totalRounds as number) || 0;
  const world = (startEvt?.world as string) || '';
  const doneEvt = events.find(e => e.type === 'done');
  const isSummarizing = events.some(e => e.type === 'summarizing');
  const isCrossing = events.some(e => e.type === 'cross_start') && !events.some(e => e.type === 'cross_result' || e.type === 'summarizing');
  const completedRounds = events.filter(e => e.type === 'round_result' || e.type === 'round_fail').length;

  const { names, charMap, links } = buildCharData(events);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graphData = useMemo(() => {
    const nodes = names.map(name => ({
      id: name, val: Math.max(2, (charMap.get(name)?.length || 0) + 1),
      color: charColor(name), eventCount: charMap.get(name)?.length || 0,
    }));
    const gLinks = links.map((l, i) => ({
      id: `link-${i}`, source: l.source, target: l.target,
      type: l.type, tension: l.tension, color: LINK_COLORS[l.type] || '#6b7280',
    }));
    return { nodes, links: gLinks };
  }, [names.length, links.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeOrder: Record<string, number> = { '初遇': 0, '发展': 1, '转折': 2, '高潮': 3 };
  const selectedEvents = selectedChar
    ? [...(charMap.get(selectedChar) || [])].sort((a, b) => (timeOrder[a.timeline] ?? 1) - (timeOrder[b.timeline] ?? 1))
    : [];

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const name = node.id as string;
    const r = Math.sqrt(node.val || 2) * 4;
    const isSelected = selectedChar === name;
    const isHovered = hoveredNode === name;
    const isRelated = selectedChar && links.some(l =>
      (l.source === selectedChar || l.target === selectedChar) && (l.source === name || l.target === name)
    );
    const dimmed = selectedChar && !isSelected && !isRelated;

    if ((isSelected || isHovered) && !dimmed) {
      ctx.beginPath(); ctx.arc(node.x, node.y, r + 6, 0, 2 * Math.PI);
      ctx.fillStyle = `${charColor(name)}33`; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = dimmed ? `${charColor(name)}22` : charColor(name);
    ctx.globalAlpha = dimmed ? 0.3 : isSelected ? 1 : 0.8;
    ctx.fill(); ctx.globalAlpha = 1;
    if (isSelected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 / globalScale; ctx.stroke(); }

    const fontSize = Math.max(10, 12 / globalScale);
    ctx.font = `${isSelected ? 'bold ' : ''}${fontSize}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = dimmed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.85)';
    ctx.fillText(name.length > 5 ? name.slice(0, 5) : name, node.x, node.y + r + 3);

    const count = node.eventCount || 0;
    if (count > 0 && !dimmed) {
      const bx = node.x + r * 0.7, by = node.y - r * 0.7;
      ctx.beginPath(); ctx.arc(bx, by, 6, 0, 2 * Math.PI);
      ctx.fillStyle = '#0d0d0d'; ctx.fill();
      ctx.strokeStyle = charColor(name); ctx.lineWidth = 1 / globalScale; ctx.stroke();
      ctx.fillStyle = charColor(name); ctx.font = `bold 8px sans-serif`;
      ctx.textBaseline = 'middle'; ctx.fillText(String(count), bx, by);
    }
  }, [selectedChar, hoveredNode, links]); // eslint-disable-line react-hooks/exhaustive-deps

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const src = link.source, tgt = link.target;
    if (!src?.x || !tgt?.x) return;
    const srcName = typeof src === 'object' ? src.id : src;
    const tgtName = typeof tgt === 'object' ? tgt.id : tgt;
    const isRelated = selectedChar && (srcName === selectedChar || tgtName === selectedChar);
    const dimmed = selectedChar && !isRelated;
    ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = link.color || '#6b7280';
    ctx.globalAlpha = dimmed ? 0.05 : isRelated ? 0.9 : 0.3;
    ctx.lineWidth = (dimmed ? 0.3 : Math.max(0.5, (link.tension || 3) / 4)) / globalScale;
    if (link.type === '暧昧') ctx.setLineDash([4 / globalScale, 3 / globalScale]);
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }, [selectedChar]); // eslint-disable-line react-hooks/exhaustive-deps

  const paintNodeArea = useCallback((node: any, color: string, ctx: CanvasRenderingContext2D) => {
    const r = Math.sqrt(node.val || 2) * 4 + 5;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color; ctx.fill();
  }, []);

  return (
    <div className="rounded-2xl bg-[#0d0d0d] border border-amber-500/20 overflow-hidden shadow-lg animate-fade-in">
      <div className="px-5 py-4 bg-gradient-to-r from-amber-500/10 to-purple-500/10 border-b border-amber-500/10">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <span className="text-lg">🌍</span> 世界观模拟实况
          </span>
          <div className="flex items-center gap-3">
            {world && <span className="text-[10px] text-gray-500 font-mono">{world}</span>}
            <span className="text-[10px] text-amber-300/60 font-mono">
              {names.length} 角色 · {doneEvt ? '✅ 完成' : isSummarizing ? '🔮 汇总中' : isCrossing ? '🔗 交叉互动' : `${completedRounds}/${totalRounds} 轮`}
            </span>
          </div>
        </div>
        {!doneEvt && totalRounds > 0 && (
          <div className="mt-3 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-purple-500 transition-all duration-500 rounded-full"
              style={{ width: `${isSummarizing ? 90 : isCrossing ? 75 : (completedRounds / totalRounds) * 70}%` }} />
          </div>
        )}
      </div>

      <div className="flex" style={{ minHeight: 420 }}>
        <div className="flex-1 relative" style={{ minHeight: 400 }}>
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            width={selectedChar ? 480 : 700}
            height={400}
            backgroundColor="#0d0d0d"
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={paintNodeArea}
            linkCanvasObject={paintLink}
            nodeCanvasObjectMode={() => 'replace'}
            linkCanvasObjectMode={() => 'replace'}
            onNodeClick={(node: any) => setSelectedChar(prev => prev === node.id ? null : node.id)}
            onNodeHover={(node: any) => setHoveredNode(node?.id || null)}
            onBackgroundClick={() => setSelectedChar(null)}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            enableNodeDrag={true}
            cooldownTicks={80}
            d3AlphaDecay={0.03}
            d3VelocityDecay={0.3}
            linkDirectionalParticles={(link: any) => {
              if (!selectedChar) return 0;
              const s = typeof link.source === 'object' ? link.source.id : link.source;
              const t = typeof link.target === 'object' ? link.target.id : link.target;
              return (s === selectedChar || t === selectedChar) ? 2 : 0;
            }}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.005}
            linkDirectionalParticleColor={(link: any) => link.color || '#6b7280'}
          />
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 bg-black/60 backdrop-blur rounded-lg px-3 py-2">
            {Object.entries(LINK_COLORS).filter(([k]) => !['对抗'].includes(k)).map(([label, color]) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
                <span className="text-[9px] text-gray-400">{label}</span>
              </div>
            ))}
          </div>
          {names.length > 0 && !selectedChar && (
            <div className="absolute top-3 right-3 text-[10px] text-gray-500 bg-black/40 backdrop-blur rounded px-2 py-1">
              点击角色查看经历
            </div>
          )}
          {doneEvt && (
            <div className="absolute bottom-3 right-3 flex gap-3 text-[10px] text-gray-500 bg-black/60 backdrop-blur rounded-lg px-3 py-2">
              <span>⚡{doneEvt.interactions as number}</span>
              <span>🤝{doneEvt.alliances as number}</span>
              <span>⚔️{doneEvt.conflicts as number}</span>
              <span>💕{doneEvt.romances as number}</span>
            </div>
          )}
        </div>
        {selectedChar && (
          <CharacterTimeline name={selectedChar} events={selectedEvents}
            color={charColor(selectedChar)} onClose={() => setSelectedChar(null)} />
        )}
      </div>
    </div>
  );
}

function CharacterTimeline({ name, events, color, onClose }: {
  name: string; events: CharEvent[]; color: string; onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events.length]);
  const tlColors: Record<string, string> = {
    '初遇': 'border-blue-500/30 text-blue-400', '发展': 'border-green-500/30 text-green-400',
    '转折': 'border-yellow-500/30 text-yellow-400', '高潮': 'border-red-500/30 text-red-400',
  };
  return (
    <div className="w-72 border-l border-white/5 bg-[#0a0a0a] flex flex-col" style={{ maxHeight: 420 }}>
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-bold text-white">{name}</span>
          <span className="text-[10px] text-gray-500">{events.length} 事件</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-xs p-1">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {events.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-xs">
            <div className="text-2xl mb-2">🕐</div>等待互动事件...
          </div>
        ) : events.map((evt, i) => (
          <div key={i} className="relative pl-4 border-l-2 border-white/5">
            <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tlColors[evt.timeline] || 'border-gray-500/30 text-gray-400'}`}>
                  {evt.timeline}
                </span>
                <span className="text-[10px] text-gray-500">{TYPE_EMOJI[evt.type] || '📌'} {evt.type}</span>
                <span className="text-[10px] text-gray-600">⚡{evt.tension}</span>
              </div>
              <div className="text-[11px] text-gray-400">与 <span className="text-gray-200">{evt.partner}</span></div>
              <p className="text-[11px] text-gray-400 leading-relaxed">{evt.description}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export default function ScreenplayCreator({ onClose, onMinimize, onProjectCreated: _onProjectCreated, onStatusChange, resumeProjectId, hidden }: ScreenplayCreatorProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const [step, setStep] = useState<Step>('config');
  const [project, setProject] = useState<ScreenplayProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [genres, setGenres] = useState<GenreItem[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);

  // 配置表单
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [audience, setAudience] = useState<'男频' | '女频' | '全年龄'>('女频');
  const [tone, setTone] = useState('爽燃');
  const [endingType, setEndingType] = useState('HE');
  const [totalEpisodes, _setTotalEpisodes] = useState(60);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; genre: string; tone: string; score: number; sourceNovel: string }>>([]);
  const [referenceNovel, setReferenceNovel] = useState('');
  const [useCharacterPool, setUseCharacterPool] = useState(false);
  const [useTimeline, setUseTimeline] = useState(false);
  const [arenaMode, setArenaMode] = useState(false);
  const [arenaStrictness, setArenaStrictness] = useState<'standard' | 'strict' | 'extreme'>('standard');
  const [arenaConcurrency, setArenaConcurrency] = useState(5);
  // 竞技结果状态
  const [arenaCandidates, setArenaCandidates] = useState<Record<string, any[]>>({});
  const [showAlternatives, setShowAlternatives] = useState(false);
  const novelFileRef = useRef<HTMLInputElement>(null);

  // 模型选择 & NSFW
  const [availableModels, setAvailableModels] = useState<Array<{ label: string; config: { provider: string; apiKey: string; apiUrl: string; model: string } }>>([]);
  const [selectedModelIdx, setSelectedModelIdx] = useState<number>(-1); // -1 = 智能路由
  const [globalNsfwEnabled, setGlobalNsfwEnabled] = useState(false); // 全局总开关（设置里开启）
  const [projectNsfw, setProjectNsfw] = useState(false); // 项目级开关（需二次确认）

  // 分集撰写
  const [writingRange, setWritingRange] = useState({ start: 1, end: 5 });
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [reviewingEp, setReviewingEp] = useState<number | null>(null);
  const [submissionData, setSubmissionData] = useState<SubmissionMaterials | null>(null);
  const [submissionTab, setSubmissionTab] = useState<'outline' | 'ecard' | 'bios' | 'synopsis'>('outline');
  const [existingProjects, setExistingProjects] = useState<ScreenplayProject[]>([]);
  // 一键优化（按项目隔离）
  const reviewAllMapRef = useRef<Map<string, {
    taskId: string; progress: string; done: number; total: number; currentEps: number[];
    error: string; preScores: Record<number, number>;
  }>>(new Map());
  const [reviewAllTaskId, setReviewAllTaskId] = useState<string | null>(null);
  const [_reviewAllCurrentEp, setReviewAllCurrentEp] = useState<number[]>([]);
  const [reviewAllProgress, setReviewAllProgress] = useState('');
  const [_reviewAllError, setReviewAllError] = useState('');
  const [reviewAllDone, setReviewAllDone] = useState(0);
  const [reviewAllTotal, setReviewAllTotal] = useState(0);
  // 记录优化前的旧分数 { [epNumber]: oldScore }
  const [_preReviewScores, setPreReviewScores] = useState<Record<number, number>>({});
  // 审核详情弹窗
  const [reviewDetailEp, setReviewDetailEp] = useState<number | null>(null);

  // 规范化项目数据（DB恢复后字段可能是JSON字符串而非对象）
  const normalizeProject = (p: ScreenplayProject): ScreenplayProject => {
    const parseIfString = <T,>(val: T | string | undefined | null, fallback: T): T => {
      if (val == null) return fallback;
      if (typeof val === 'string') { try { return JSON.parse(val); } catch { return fallback; } }
      return val;
    };
    const episodes = parseIfString(p.episodes, [] as EpisodeScript[]);
    const validEpisodes = (Array.isArray(episodes) ? episodes : []).filter(e => e.number != null);
    const reviews = parseIfString(p.reviews, {} as Record<number, ReviewScore>);
    const episodeDirectory = parseIfString(p.episodeDirectory, undefined as EpisodeDirectoryItem[] | undefined);
    return {
      ...p,
      episodes: validEpisodes,
      reviews: (reviews && typeof reviews === 'object' && !Array.isArray(reviews)) ? reviews : {},
      episodeDirectory: Array.isArray(episodeDirectory) ? episodeDirectory : undefined,
      creativePlan: parseIfString(p.creativePlan, undefined as CreativePlan | undefined),
      characterDesign: parseIfString(p.characterDesign, undefined as CharacterDesign | undefined),
      config: parseIfString(p.config, p.config),
    };
  };

  // 加载题材列表
  useEffect(() => {
    fetch('/api/screenplay/genres').then(r => r.json()).then(d => {
      if (d?.genres) setGenres(d.genres);
    }).catch(() => {});
    // 加载Agent仓库
    fetch('/api/agents').then(r => r.json()).then(d => {
      if (d?.agents) setAgents(d.agents);
    }).catch(() => {});
    // 加载已有剧本项目
    fetch('/api/screenplay/list').then(r => r.json()).then(d => {
      if (d?.projects?.length > 0) setExistingProjects(d.projects.filter((p: ScreenplayProject) => p.status !== 'exported'));
    }).catch(() => {});
    // 加载可用模型列表 & NSFW 状态
    Promise.all([fetch('/api/llm-config'), fetch('/api/llm-config/extra'), fetch('/api/nsfw')])
      .then(async ([mainRes, extraRes, nsfwRes]) => {
        const models: typeof availableModels = [];
        if (mainRes.ok) {
          const m = await mainRes.json();
          if (m?.model) models.push({ label: `${m.provider}/${m.model} (主)`, config: { provider: m.provider, apiKey: '', apiUrl: m.apiUrl, model: m.model } });
        }
        if (extraRes.ok) {
          const e = await extraRes.json();
          (e?.configs || []).forEach((c: any, i: number) => {
            if (c?.model) models.push({ label: `${c.provider}/${c.model} (${i + 1})`, config: { provider: c.provider, apiKey: '', apiUrl: c.apiUrl, model: c.model } });
          });
        }
        setAvailableModels(models);
        if (nsfwRes.ok) {
          const n = await nsfwRes.json();
          setGlobalNsfwEnabled(n?.enabled || false);
        }
      }).catch(() => {});
    // 如果有指定恢复的项目ID，直接加载
    if (resumeProjectId) {
      fetch(`/api/screenplay/${resumeProjectId}`).then(r => r.json()).then(d => {
        if (d?.project) {
          const p = normalizeProject(d.project);
          setProject(p);
          const statusStepMap: Record<string, Step> = p.config?.arenaMode
            ? { config_done: 'plan', plan_done: 'characters', characters_done: 'directory',
                directory_done: 'writing', writing: 'writing', review: 'review', exported: 'submission' }
            : { config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
                directory_done: 'directory', writing: 'writing', review: 'review', exported: 'submission' };
          setStep(statusStepMap[p.status] || 'config');
          if (p.submissionMaterials) setSubmissionData(p.submissionMaterials);
          setExistingProjects([]);
          // 竞技模式：尝试恢复taskId以重连WebSocket
          if (p.config?.arenaMode) {
            fetch(`/api/screenplay/${resumeProjectId}/arena/status`).then(r => r.json()).then(s => {
              if (s?.taskId && s.status !== 'completed' && s.status !== 'stopped') setTaskId(s.taskId);
            }).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }, []);

  // 当 resumeProjectId 从外部变化时（点击不同项目卡片），重新加载对应项目
  const prevResumeIdRef = useRef(resumeProjectId);
  useEffect(() => {
    if (resumeProjectId && resumeProjectId !== prevResumeIdRef.current) {
      prevResumeIdRef.current = resumeProjectId;
      // 切换项目时清除旧任务状态
      setTaskId(null); setLoading(false); saveAndRestoreReviewState(resumeProjectId);
      fetch(`/api/screenplay/${resumeProjectId}`).then(r => r.json()).then(d => {
        if (d?.project) {
          const p = normalizeProject(d.project);
          setProject(p);
          const statusStepMap: Record<string, Step> = p.config?.arenaMode
            ? { config_done: 'plan', plan_done: 'characters', characters_done: 'directory',
                directory_done: 'writing', writing: 'writing', review: 'review', exported: 'submission' }
            : { config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
                directory_done: 'directory', writing: 'writing', review: 'review', exported: 'submission' };
          setStep(statusStepMap[p.status] || 'config');
          if (p.submissionMaterials) setSubmissionData(p.submissionMaterials);
          else setSubmissionData(null);
          setExistingProjects([]);
          setError('');
          // 竞技模式：尝试恢复taskId以重连WebSocket
          if (p.config?.arenaMode) {
            fetch(`/api/screenplay/${resumeProjectId}/arena/status`).then(r => r.json()).then(s => {
              if (s?.taskId && s.status !== 'completed' && s.status !== 'stopped') setTaskId(s.taskId);
            }).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }, [resumeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 用 ref 保持最新 project.id，避免 useCallback 闭包过期
  const projectIdRef = useRef<string | undefined>(project?.id);
  projectIdRef.current = project?.id;

  // 刷新项目数据
  const refreshProject = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    try {
      const res = await fetch(`/api/screenplay/${pid}`);
      const data = await res.json();
      if (data?.project) {
        const normalized = normalizeProject(data.project);
        setProject(normalized);
      }
    } catch (err) { console.error('[refreshProject] error:', err); }
  }, []);

  // WebSocket 进度回调（signal='refresh' 表示中间刷新，不清除 taskId）
  const handleTaskDone = useCallback((signal?: string) => {
    if (signal === 'refresh') {
      refreshProject();
      return;
    }
    setTaskId(null);
    setLoading(false);
    refreshProject();
  }, [refreshProject]);

  const { logs, error: wsError } = useTaskProgress(taskId, handleTaskDone);

  // 通知父组件当前状态（用于后台运行浮动指示器）
  useEffect(() => {
    onStatusChange?.({
      step,
      stepLabel: STEP_LABELS[step]?.zh || step,
      loading: loading || !!taskId || !!reviewAllTaskId,
      projectTitle: project?.selectedTitle || project?.creativePlan?.titleOptions?.[0]?.title,
    });
  }, [step, loading, taskId, reviewAllTaskId, project?.selectedTitle, project?.creativePlan?.titleOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // 恢复已有项目
  // 保存当前项目的优化状态到 Map，恢复目标项目的状态
  const saveAndRestoreReviewState = (targetProjectId?: string) => {
    // 保存当前项目状态
    const curId = projectIdRef.current;
    if (curId && reviewAllTaskId) {
      reviewAllMapRef.current.set(curId, {
        taskId: reviewAllTaskId, progress: reviewAllProgress,
        done: reviewAllDone, total: reviewAllTotal, currentEps: _reviewAllCurrentEp,
        error: _reviewAllError, preScores: _preReviewScores,
      });
    }
    // 恢复目标项目状态
    const saved = targetProjectId ? reviewAllMapRef.current.get(targetProjectId) : undefined;
    if (saved) {
      setReviewAllTaskId(saved.taskId);
      setReviewAllProgress(saved.progress);
      setReviewAllDone(saved.done);
      setReviewAllTotal(saved.total);
      setReviewAllCurrentEp(saved.currentEps);
      setReviewAllError(saved.error);
      setPreReviewScores(saved.preScores);
    } else {
      setReviewAllTaskId(null);
      setReviewAllCurrentEp([]);
      setReviewAllProgress('');
      setReviewAllError('');
      setReviewAllDone(0);
      setReviewAllTotal(0);
      setPreReviewScores({});
    }
  };

  const resumeProject = (p: ScreenplayProject) => {
    saveAndRestoreReviewState(p.id);
    setProject(normalizeProject(p));
    const statusStepMap: Record<string, Step> = p.config?.arenaMode
      ? { config_done: 'plan', plan_done: 'characters', characters_done: 'directory',
          directory_done: 'writing', writing: 'writing', review: 'review', exported: 'submission' }
      : { config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
          directory_done: 'directory', writing: 'writing', review: 'review', exported: 'submission' };
    setStep(statusStepMap[p.status] || 'config');
    if (p.submissionMaterials) setSubmissionData(p.submissionMaterials);
    setExistingProjects([]);
    // 竞技模式：尝试恢复taskId以重连WebSocket
    if (p.config?.arenaMode) {
      fetch(`/api/screenplay/${p.id}/arena/status`).then(r => r.json()).then(s => {
        if (s?.taskId && s.status !== 'completed' && s.status !== 'stopped') setTaskId(s.taskId);
      }).catch(() => {});
    }
  };

  // 题材选择切换
  const toggleGenre = (key: string) => {
    setSelectedGenres(prev =>
      prev.includes(key) ? prev.filter(g => g !== key) : prev.length < 2 ? [...prev, key] : prev
    );
  };

  // ============================================================
  // 竞技模式：候选获取与选择
  // ============================================================

  const fetchArenaCandidates = async (stage: string) => {
    if (!project?.id) return;
    try {
      const res = await fetch(`/api/screenplay/${project.id}/arena/candidates/${stage}`);
      const data = await res.json();
      if (data?.candidates) setArenaCandidates(prev => ({ ...prev, [stage]: data.candidates }));
    } catch { /* ignore */ }
  };

  const handleArenaSelect = async (stage: string, candidateId: string) => {
    if (!project?.id) return;
    try {
      await fetch(`/api/screenplay/${project.id}/arena/select`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, candidateId }),
      });
      await fetchArenaCandidates(stage);
      await refreshProject();
    } catch { /* ignore */ }
  };

  // 竞技模式：自动加载当前步骤的候选
  useEffect(() => {
    if (!project?.config?.arenaMode || !project?.id) return;
    const stageMap: Record<string, string> = { plan: 'creative_plan', characters: 'character', directory: 'directory', writing: 'episode' };
    const stage = stageMap[step];
    if (stage && !arenaCandidates[stage]) fetchArenaCandidates(stage);
  }, [step, project?.id, project?.config?.arenaMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // API 调用
  // ============================================================

  const handleCreate = async () => {
    if (selectedGenres.length === 0) { setError('请至少选择一个题材'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/screenplay/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedGenres, audience, tone, endingType, totalEpisodes, language: 'zh-CN', mode: 'domestic', customPrompt: customPrompt || undefined, agentId: selectedAgentId || undefined, referenceNovel: referenceNovel || undefined, useCharacterPool: useCharacterPool || undefined, useTimeline: useTimeline || undefined, fixedModel: selectedModelIdx >= 0 ? availableModels[selectedModelIdx]?.config : undefined, nsfw: (globalNsfwEnabled && projectNsfw) || undefined, arenaMode: arenaMode || undefined, arenaConfig: arenaMode ? { groupCount: 10, membersPerGroup: 4, strictness: arenaStrictness, concurrency: arenaConcurrency, passScore: arenaStrictness === 'extreme' ? 7.0 : arenaStrictness === 'strict' ? 6.0 : 5.5 } : undefined }),
      });
      const data = await res.json();
      if (data?.project) { setProject(normalizeProject(data.project)); setStep('plan'); if (data.taskId) setTaskId(data.taskId); }
      else setError(data?.error || '创建失败');
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const handleGeneratePlan = async () => {
    if (!project) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/creative-plan`, { method: 'POST' });
      const data = await res.json();
      if (data?.async && data.taskId) setTaskId(data.taskId);
      else if (data?.error) { setError(data.error); setLoading(false); }
    } catch (err) { setError((err as Error).message); setLoading(false); }
  };

  const handleGenerateCharacters = async () => {
    if (!project) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/characters`, { method: 'POST' });
      const data = await res.json();
      if (data?.async && data.taskId) setTaskId(data.taskId);
      else if (data?.error) { setError(data.error); setLoading(false); }
    } catch (err) { setError((err as Error).message); setLoading(false); }
  };

  const handleGenerateDirectory = async () => {
    if (!project) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/directory`, { method: 'POST' });
      const data = await res.json();
      if (data?.async && data.taskId) setTaskId(data.taskId);
      else if (data?.error) { setError(data.error); setLoading(false); }
    } catch (err) { setError((err as Error).message); setLoading(false); }
  };

  const handleWriteEpisodes = async () => {
    if (!project) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/episode-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startEp: writingRange.start, endEp: writingRange.end }),
      });
      const data = await res.json();
      if (data?.async && data.taskId) setTaskId(data.taskId);
      else if (data?.error) { setError(data.error); setLoading(false); }
    } catch (err) { setError((err as Error).message); setLoading(false); }
  };

  const handleRetryFailed = async () => {
    if (!project) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/retry-failed`, { method: 'POST' });
      const data = await res.json();
      if (data?.async && data.taskId) setTaskId(data.taskId);
      else if (data?.error) { setError(data.error); setLoading(false); }
    } catch (err) { setError((err as Error).message); setLoading(false); }
  };

  const handleReview = async (epNum: number) => {
    setReviewingEp(epNum); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project!.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber: epNum }),
      });
      const data = await res.json();
      if (data?.review) await refreshProject();
      else setError(data?.error || '自检失败');
    } catch (err) { setError((err as Error).message); }
    finally { setReviewingEp(null); }
  };

  // 一键优化：批量自检+改写所有集
  const handleReviewAll = async (skipReviewed = false) => {
    if (!project) return;
    setError('');
    // 记录优化前的旧分数
    const oldScores: Record<number, number> = {};
    for (const ep of project.episodes) {
      const r = project.reviews[ep.number];
      if (r) oldScores[ep.number] = r.total;
    }
    setPreReviewScores(oldScores);
    setReviewAllCurrentEp([]);
    setReviewAllProgress('');
    setReviewAllError('');
    setReviewAllDone(0);
    // 断点续传时，total 只算未评审的集数
    const unreviewedCount = skipReviewed
      ? project.episodes.filter(ep => !project.reviews[ep.number]).length
      : project.episodes.length;
    setReviewAllTotal(unreviewedCount);
    try {
      const res = await fetch(`/api/screenplay/${project.id}/review-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipReviewed }),
      });
      const data = await res.json();
      if (data?.async && data.taskId) {
        setReviewAllTaskId(data.taskId);
        reviewAllMapRef.current.set(project.id, {
          taskId: data.taskId, progress: '', done: 0, total: unreviewedCount,
          currentEps: [], error: '', preScores: oldScores,
        });
      }
      else if (data?.error) setError(data.error);
    } catch (err) { setError((err as Error).message); }
  };

  // 一键优化 WebSocket 进度监听（支持多项目并行，不随切换断开）
  const reviewWsMapRef = useRef<Map<string, WebSocket>>(new Map());

  // 启动对某个 taskId 的 WebSocket 监听
  const startReviewWs = useCallback((taskId: string) => {
    if (reviewWsMapRef.current.has(taskId)) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.taskId !== taskId) return;
        const status = msg.data?.status || msg.status;
        const progressRaw = msg.data?.progress || msg.progress;
        const errorText = msg.data?.error || msg.error;

        let parsed: { msg?: string; currentEps?: number[]; currentEp?: number | null; done?: number; total?: number; completedEp?: number; score?: number } | null = null;
        try { parsed = JSON.parse(progressRaw); } catch { /* plain string fallback */ }

        // 更新 Map 中的状态（无论当前显示哪个项目）
        const mapEntry = Array.from(reviewAllMapRef.current.entries()).find(([, v]) => v.taskId === taskId);
        const pid = mapEntry?.[0];

        if (status === 'processing') {
          if (pid && parsed) {
            const entry = reviewAllMapRef.current.get(pid)!;
            entry.progress = parsed.msg || '';
            entry.currentEps = parsed.currentEps ?? (parsed.currentEp != null ? [parsed.currentEp] : []);
            if (typeof parsed.done === 'number') entry.done = parsed.done;
            if (typeof parsed.total === 'number') entry.total = parsed.total;
          }
          // 如果是当前项目，更新 UI state
          if (pid === projectIdRef.current) {
            if (parsed) {
              setReviewAllProgress(parsed.msg || '');
              setReviewAllCurrentEp(parsed.currentEps ?? (parsed.currentEp != null ? [parsed.currentEp] : []));
              if (typeof parsed.done === 'number') setReviewAllDone(parsed.done);
              if (typeof parsed.total === 'number') setReviewAllTotal(parsed.total);
              if (parsed.completedEp) refreshProject();
            } else {
              setReviewAllProgress(progressRaw || '');
            }
          }
        } else if (status === 'done') {
          if (pid) reviewAllMapRef.current.delete(pid);
          reviewWsMapRef.current.delete(taskId);
          if (pid === projectIdRef.current) {
            if (parsed) setReviewAllProgress(parsed.msg || '');
            setReviewAllCurrentEp([]);
            setReviewAllTaskId(null);
            refreshProject();
          }
          ws.close();
        } else if (status === 'error') {
          if (pid) reviewAllMapRef.current.delete(pid);
          reviewWsMapRef.current.delete(taskId);
          if (pid === projectIdRef.current) {
            setReviewAllError(errorText || '优化失败');
            setReviewAllCurrentEp([]);
            setReviewAllTaskId(null);
          }
          ws.close();
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      reviewWsMapRef.current.delete(taskId);
    };
    ws.onclose = () => {
      reviewWsMapRef.current.delete(taskId);
      // 如果任务仍在 Map 中（未完成），延迟重连
      const stillRunning = Array.from(reviewAllMapRef.current.values()).some(v => v.taskId === taskId);
      if (stillRunning) {
        setTimeout(() => startReviewWs(taskId), 2000);
      }
    };

    reviewWsMapRef.current.set(taskId, ws);
  }, [refreshProject]);

  // 当 reviewAllTaskId 变化时启动 WS（新任务触发）
  useEffect(() => {
    if (reviewAllTaskId) startReviewWs(reviewAllTaskId);
  }, [reviewAllTaskId, startReviewWs]);

  // 检查后端是否有正在运行的 review-all 任务（恢复断开的进度）
  const checkReviewStatus = useCallback(async (pid: string) => {
    // 如果前端已经有该项目的 taskId，不需要检查
    if (reviewAllMapRef.current.has(pid)) return;
    try {
      const res = await fetch(`/api/screenplay/${pid}/review-status`);
      const data = await res.json();
      if (data?.running && data.taskId) {
        // 恢复状态
        const state = { taskId: data.taskId, progress: data.msg || '', done: data.done || 0, total: data.total || 0, currentEps: [] as number[], error: '', preScores: {} as Record<number, number> };
        reviewAllMapRef.current.set(pid, state);
        if (pid === projectIdRef.current) {
          setReviewAllTaskId(data.taskId);
          setReviewAllProgress(data.msg || '');
          setReviewAllDone(data.done || 0);
          setReviewAllTotal(data.total || 0);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // 进入 review 步骤或从后台恢复时，检查是否有正在运行的任务
  useEffect(() => {
    if (step === 'review' && project?.id && !reviewAllTaskId) {
      checkReviewStatus(project.id);
    }
  }, [step, project?.id, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // 生成投稿材料
  const handleSubmission = async (forceRegenerate = false) => {
    if (!project) return;
    // 如果已有投稿材料且非强制重新生成，直接展示
    if (project.submissionMaterials && !forceRegenerate) {
      setSubmissionData(project.submissionMaterials);
      setStep('submission');
      return;
    }
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/submission`, { method: 'POST' });
      const data = await res.json();
      if (data?.materials) { setSubmissionData(data.materials); setStep('submission'); await refreshProject(); }
      else setError(data?.error || '投稿材料生成失败');
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const handleSelectTitle = async (title: string) => {
    if (!project) return;
    await fetch(`/api/screenplay/${project.id}/select-title`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await refreshProject();
  };

  // Markdown 转纯文本（去除 md 标记，保留可读格式）
  const mdToPlainText = (md: string): string => {
    return md
      .replace(/^#{1,6}\s+/gm, '')           // 去除标题标记
      .replace(/\*\*(.+?)\*\*/g, '$1')       // 去除粗体
      .replace(/\*(.+?)\*/g, '$1')           // 去除斜体
      .replace(/^\|.*\|$/gm, (line) => {     // 表格转为 key: value 格式
        const cells = line.split('|').filter(c => c.trim());
        if (cells.every(c => /^[-\s]+$/.test(c))) return ''; // 去除分隔行
        if (cells.length === 2) return `${cells[0].trim()}：${cells[1].trim()}`;
        return cells.map(c => c.trim()).join('  ');
      })
      .replace(/^>\s?/gm, '')                // 去除引用标记
      .replace(/^---+$/gm, '')               // 去除分隔线
      .replace(/\n{3,}/g, '\n\n')            // 压缩多余空行
      .trim();
  };

  // 触发文件下载的通用方法（兼容非 HTTPS 环境）
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 延迟释放，确保下载完成
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  // 下载单项投稿材料（纯文本格式）
  const handleDownloadMaterial = (content: string, suffix: string) => {
    const title = project?.selectedTitle || project?.creativePlan?.titleOptions?.[0]?.title || '剧本';
    const plainText = mdToPlainText(content);
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `${title}-${suffix}.txt`);
  };

  // 一键下载全部投稿材料（ZIP 包含4个标签 + 分集剧本）
  const handleDownloadAll = async () => {
    if (!submissionData || !project) return;
    const title = project.selectedTitle || project.creativePlan?.titleOptions?.[0]?.title || '剧本';

    const files = [
      { name: `${title}-集纲.txt`, text: mdToPlainText(submissionData.episodeOutline || '') },
      { name: `${title}-E-card.txt`, text: mdToPlainText(submissionData.ecard || '') },
      { name: `${title}-人物小传.txt`, text: mdToPlainText(submissionData.characterBios || '') },
      { name: `${title}-剧本大纲.txt`, text: mdToPlainText(submissionData.scriptSynopsis || '') },
    ];

    // 获取完整分集剧本
    try {
      const res = await fetch(`/api/screenplay/${project.id}/export`, { method: 'POST' });
      const data = await res.json();
      if (data?.content) {
        files.push({ name: `${title}-分集剧本.txt`, text: mdToPlainText(data.content) });
      }
    } catch { /* 降级：不含分集剧本 */ }

    const zipBlob = createZipBlob(files);
    triggerDownload(zipBlob, `${title}-投稿材料.zip`);
  };

  // 步骤导航（根据项目状态自动跳转）
  useEffect(() => {
    if (!project) return;
    // 竞技模式：阶段完成后自动前进到下一步（不需要用户手动确认）
    const statusMap: Record<string, Step> = project.config?.arenaMode
      ? {
          config_done: 'plan', plan_done: 'characters', characters_done: 'directory',
          directory_done: 'writing', writing: 'writing', review: 'review', exported: 'submission',
        }
      : {
          config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
          directory_done: 'directory', writing: 'writing', review: 'review', exported: 'submission',
        };
    const targetStep = statusMap[project.status];
    if (targetStep && STEPS.indexOf(targetStep) > STEPS.indexOf(step)) setStep(targetStep);
  }, [project?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // 渲染
  // ============================================================

  const stepIndex = STEPS.indexOf(step);
  const displayError = error || wsError;

  // 模拟日志：实时logs优先，否则用持久化的simulationLogs
  const simPanelLogs = logs.some(l => l.startsWith('[SIM]')) ? logs : project?.simulationLogs || [];
  const hasSimLogs = simPanelLogs.some(l => l.startsWith('[SIM]'));

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col" style={hidden ? { display: 'none' } : undefined}>
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-8 border-b border-white/5 bg-[#0a0a0a]/95 backdrop-blur z-20">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">✍️</span>
              {isZh ? '剧本创作' : 'Screenplay Creator'}
            </h1>
            {project?.selectedTitle && <p className="text-xs text-gray-500 font-mono mt-0.5">{project.selectedTitle}</p>}
          </div>
        </div>
        
        {/* Step Progress */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const isActive = s === step;
            const isDone = i < stepIndex;
            return (
              <div key={s} className="flex items-center">
                <div className={`flex flex-col items-center gap-1 px-3 ${isActive ? 'opacity-100' : isDone ? 'opacity-60 hover:opacity-80 cursor-pointer' : 'opacity-30'}`}
                  onClick={() => isDone && setStep(s)}>
                  <div className={`w-2.5 h-2.5 rounded-full transition-all ${isActive ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)] scale-125' : isDone ? 'bg-green-500' : 'bg-gray-600'}`} />
                  <span className="text-[10px] font-medium uppercase tracking-wider">{isZh ? STEP_LABELS[s].zh : STEP_LABELS[s].en}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`w-8 h-[1px] ${isDone ? 'bg-green-500/50' : 'bg-white/10'}`} />}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* 当已有项目时，显示"项目列表"按钮，可切换/新建项目 */}
          {project && step !== 'config' && (
            <button onClick={() => {
              // 回到项目列表，重新拉取未完成项目
              fetch('/api/screenplay/list').then(r => r.json()).then(d => {
                if (d?.projects) setExistingProjects(d.projects.filter((p: ScreenplayProject) => p.status !== 'exported'));
              }).catch(() => {});
              setProject(null); setStep('config'); setTaskId(null); setLoading(false);
              setError(''); setSubmissionData(null); saveAndRestoreReviewState();
            }}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white hover:bg-[#222] transition-colors flex items-center gap-1.5">
              📂 {isZh ? '项目列表' : 'Projects'}
            </button>
          )}
          <button onClick={onMinimize || onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white hover:bg-[#222] transition-colors">
            {isZh ? '后台运行' : 'Run in Background'}
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
        <div className="max-w-5xl mx-auto px-8 py-10">
          {/* 进度/错误提示 */}
          {loading && logs.length === 0 && (
            <div className="mb-8 rounded-xl bg-[#0d0d0d] border border-blue-500/20 overflow-hidden shadow-lg animate-fade-in">
              <div className="flex items-center gap-3 px-4 py-4">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                <span className="text-sm text-blue-300">{isZh ? '正在准备任务...' : 'Preparing task...'}</span>
              </div>
            </div>
          )}
          {logs.length > 0 && <div className="mb-8"><ProgressLog logs={logs} /></div>}
          {displayError && (
            <div className="mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center gap-3 animate-fade-in">
              <span className="text-xl">⚠️</span>
              {displayError}
            </div>
          )}

          {/* Step: 选题定位 */}
          {step === 'config' && (
            <div className="space-y-8 animate-fade-in">
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-white mb-3">{isZh ? '开始你的创作之旅' : 'Start Your Journey'}</h2>
                <p className="text-gray-500">{isZh ? '配置剧本的基本参数，AI 将为你构建世界' : 'Configure the basics, AI will build the world'}</p>
              </div>

              {/* 已有项目恢复 */}
              {existingProjects.length > 0 && (
                <div className="p-6 rounded-2xl bg-[#161616] border border-amber-500/20 space-y-4 shadow-lg shadow-amber-900/5">
                  <div className="flex items-center gap-2 text-amber-400 font-medium">
                    <span className="text-lg">📂</span>
                    {isZh ? '发现未完成的草稿' : 'Unfinished drafts found'}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {existingProjects.map(p => (
                      <div key={p.id} className="flex items-center justify-between p-4 rounded-xl bg-[#0a0a0a] border border-white/5 hover:border-amber-500/30 transition-all group">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200 font-medium truncate">{p.selectedTitle || p.creativePlan?.titleOptions?.[0]?.title || p.config.genres.join(' + ')}</p>
                          <p className="text-xs text-gray-500 mt-1 font-mono">
                            {new Date(p.updatedAt).toLocaleDateString()} · {p.status}
                          </p>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => resumeProject(p)} className="px-3 py-1.5 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                            {isZh ? '继续' : 'Resume'}
                          </button>
                          <button onClick={async () => {
                            await fetch(`/api/screenplay/${p.id}`, { method: 'DELETE' });
                            setExistingProjects(prev => prev.filter(x => x.id !== p.id));
                          }} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <CloseIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* 左侧配置 */}
                <div className="space-y-6">
                  <section>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{isZh ? '题材 (选1-2个)' : 'Genre (1-2)'}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {genres.map(g => (
                        <button key={g.key} onClick={() => toggleGenre(g.key)}
                          className={`p-3 rounded-xl text-left border transition-all ${
                            selectedGenres.includes(g.key)
                              ? 'bg-green-600/20 border-green-500/50 text-green-300 shadow-[0_0_10px_rgba(34,197,94,0.1)]'
                              : 'bg-[#161616] border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                          }`}>
                          <div className="text-sm font-medium">{g.name}</div>
                          <div className="text-[10px] opacity-60 mt-0.5">{g.desc}</div>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{isZh ? '核心参数' : 'Core Params'}</label>
                    <div className="space-y-4 bg-[#161616] p-5 rounded-2xl border border-white/5">
                      <div>
                        <span className="text-xs text-gray-500 block mb-2">{isZh ? '目标受众' : 'Audience'}</span>
                        <div className="flex gap-2">
                          {(['男频', '女频', '全年龄'] as const).map(a => (
                            <button key={a} onClick={() => setAudience(a)}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                                audience === a ? 'bg-white text-black' : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#222]'
                              }`}>{a}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 block mb-2">{isZh ? '故事基调' : 'Tone'}</span>
                        <div className="flex flex-wrap gap-2">
                          {TONES.map(t => (
                            <button key={t} onClick={() => setTone(t)}
                              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                                tone === t ? 'border-green-500 text-green-400 bg-green-500/10' : 'border-white/10 text-gray-400 hover:border-white/30'
                              }`}>{t}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 block mb-2">{isZh ? '结局类型' : 'Ending'}</span>
                        <div className="flex flex-wrap gap-2">
                          {ENDINGS.map(e => (
                            <button key={e.value} onClick={() => setEndingType(e.value)}
                              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                                endingType === e.value ? 'border-purple-500 text-purple-400 bg-purple-500/10' : 'border-white/10 text-gray-400 hover:border-white/30'
                              }`}>{e.label}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* 右侧配置 */}
                <div className="space-y-6">
                  <section>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{isZh ? '参考素材' : 'Reference'}</label>
                    <div className="bg-[#161616] p-5 rounded-2xl border border-white/5 space-y-4">
                      <div>
                        <span className="text-xs text-gray-500 block mb-2">{isZh ? '参考小说 (可选)' : 'Novel (Optional)'}</span>
                        {referenceNovel ? (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-green-900/20 border border-green-500/30">
                            <div className="flex items-center gap-2">
                              <BookIcon className="w-4 h-4 text-green-400" />
                              <span className="text-xs text-green-300">{isZh ? '已加载' : 'Loaded'} ({referenceNovel.length} chars)</span>
                            </div>
                            <button onClick={() => setReferenceNovel('')} className="text-xs text-red-400 hover:text-red-300">✕</button>
                          </div>
                        ) : (
                          <div onClick={() => novelFileRef.current?.click()}
                            className="border border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-green-500/50 hover:bg-green-500/5 transition-all group">
                            <div className="w-10 h-10 rounded-full bg-[#0a0a0a] flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                              <span className="text-xl text-gray-500 group-hover:text-green-400">+</span>
                            </div>
                            <span className="text-xs text-gray-400">{isZh ? '点击上传小说文件 (.txt)' : 'Upload .txt file'}</span>
                            <input ref={novelFileRef} type="file" accept=".txt,.text" className="hidden" onChange={(e) => {
                              const file = e.target.files?.[0]; if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const buffer = ev.target?.result as ArrayBuffer; if (!buffer) return;
                                const utf8 = new TextDecoder('utf-8').decode(buffer);
                                if (utf8.includes('\uFFFD')) {
                                  try { setReferenceNovel(new TextDecoder('gbk').decode(buffer)); } catch { setReferenceNovel(utf8); }
                                } else { setReferenceNovel(utf8); }
                              };
                              reader.readAsArrayBuffer(file);
                              e.target.value = '';
                            }} />
                          </div>
                        )}
                      </div>

                      {agents.length > 0 && (
                        <div>
                          <span className="text-xs text-gray-500 block mb-2">{isZh ? '写作 Agent' : 'Writing Agent'}</span>
                          <select value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0a] border border-white/10 text-gray-300 text-xs outline-none focus:border-green-500/50">
                            <option value="">{isZh ? '默认编剧 (Default)' : 'Default'}</option>
                            {agents.map(a => (
                              <option key={a.id} value={a.id}>{a.name} ({a.genre})</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* 模型选择 */}
                      {availableModels.length > 0 && (
                        <div>
                          <span className="text-xs text-gray-500 block mb-2">{isZh ? '指定模型' : 'Fixed Model'}</span>
                          <select value={selectedModelIdx} onChange={e => setSelectedModelIdx(Number(e.target.value))}
                            className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0a] border border-white/10 text-gray-300 text-xs outline-none focus:border-green-500/50">
                            <option value={-1}>{isZh ? '智能路由 (不同阶段自动选模型)' : 'Smart Routing (auto)'}</option>
                            {availableModels.map((m, i) => (
                              <option key={i} value={i}>{m.label}</option>
                            ))}
                          </select>
                          <p className="text-[10px] text-gray-600 mt-1">{isZh ? '不选则按生成/评估/优化阶段自动分配' : 'Auto-assign by task type if not set'}</p>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* 群演仓库开关 */}
                  <section className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          🎭 {isZh ? '使用群演仓库' : 'Character Pool'}
                        </span>
                        <p className="text-[10px] text-gray-500 mt-1">{isZh ? '从群演仓库中匹配角色，在世界观中模拟互动，让每个角色都像真实活着的人' : 'Match characters from pool, simulate in world'}</p>
                      </div>
                      <button onClick={() => setUseCharacterPool(!useCharacterPool)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${useCharacterPool ? 'bg-amber-500' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useCharacterPool ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {useCharacterPool && (
                      <p className="text-[10px] text-amber-400/80 mt-2">✨ {isZh ? '角色开发阶段将从群演仓库智能匹配10-100个角色，通过世界观模拟生成最终角色体系' : 'Will match 10-100 characters and simulate interactions'}</p>
                    )}
                  </section>

                  <section>
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-200">
                          🕰️ {isZh ? '跨时代时间线' : 'Timeline Architecture'}
                        </span>
                        <p className="text-[10px] text-gray-500 mt-1">{isZh ? '适用于仙侠/穿越/科幻等跨时代宏大叙事，自动生成多时代设定、伏笔收线图谱和因果链' : 'Multi-era narrative with foreshadow graphs and causal chains'}</p>
                      </div>
                      <button onClick={() => setUseTimeline(!useTimeline)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${useTimeline ? 'bg-purple-500' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useTimeline ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {useTimeline && (
                      <p className="text-[10px] text-purple-400/80 mt-2">🌌 {isZh ? '创作方案将包含多时代架构、伏笔/收线节点图谱和跨时代因果链，角色支持转世/传承/封印等跨时代存在形式' : 'Plan will include multi-era architecture, foreshadow graph and causal chains'}</p>
                    )}
                  </section>

                  {/* 竞技模式开关 */}
                  <section className="p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                          ⚔️ {isZh ? '竞技模式' : 'Arena Mode'}
                        </span>
                        <p className="text-[10px] text-gray-500 mt-1">{isZh ? '10大编剧风格各自带队竞争，百Agent漏斗式淘汰，优中选优' : '10 writing styles compete, 100 agents funnel selection'}</p>
                      </div>
                      <button onClick={() => setArenaMode(!arenaMode)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${arenaMode ? 'bg-cyan-500' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${arenaMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {arenaMode && (
                      <div className="mt-3 space-y-3">
                        <p className="text-[10px] text-cyan-400/80">⚔️ {isZh ? '听花岛、倾故、麦芽传媒等10大编剧风格将各自带队竞争，经过创意方案→角色开发→分集目录→分集剧本四轮淘汰，最终产出Top 3精品剧本' : '10 master styles compete through 4 rounds of elimination'}</p>
                        <div className="flex items-center gap-3">
                          <label className="text-[10px] text-gray-400">{isZh ? '评审严格度' : 'Strictness'}</label>
                          <div className="flex gap-1">
                            {(['standard', 'strict', 'extreme'] as const).map(level => (
                              <button key={level} onClick={() => setArenaStrictness(level)}
                                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${arenaStrictness === level ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50' : 'bg-white/5 text-gray-500 border border-white/10'}`}>
                                {level === 'standard' ? (isZh ? '标准' : 'Standard') : level === 'strict' ? (isZh ? '严格' : 'Strict') : (isZh ? '极致' : 'Extreme')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-[10px] text-gray-400">{isZh ? '并发数' : 'Concurrency'}</label>
                          <input type="number" min={1} max={20} value={arenaConcurrency} onChange={e => setArenaConcurrency(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                            className="w-16 px-2 py-0.5 rounded bg-[#161616] border border-white/10 text-gray-300 text-[10px] outline-none focus:border-cyan-500/30" />
                        </div>
                      </div>
                    )}
                  </section>

                  <section>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{isZh ? '自定义要求' : 'Custom Prompt'}</label>
                    <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                      placeholder={isZh ? '例如：主角是一个退伍军人，故事发生在深圳...' : 'e.g. The protagonist is a veteran...'}
                      className="w-full h-32 px-4 py-3 rounded-2xl bg-[#161616] border border-white/5 text-gray-300 text-sm resize-none placeholder-gray-600 focus:border-green-500/30 focus:ring-1 focus:ring-green-500/10 outline-none transition-all" />
                  </section>

                  {/* 项目级 NSFW 开关 - 仅全局开启时显示 */}
                  {globalNsfwEnabled && (
                    <section className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">NSFW</span>
                          <p className="text-[10px] text-gray-500 mt-1">{isZh ? '开启后本剧本将生成成人内容' : 'Enable adult content for this project'}</p>
                        </div>
                        <button onClick={() => setProjectNsfw(!projectNsfw)}
                          className={`relative w-10 h-5 rounded-full transition-colors ${projectNsfw ? 'bg-red-500' : 'bg-white/10'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${projectNsfw ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {projectNsfw && (
                        <p className="text-[10px] text-red-400/80 mt-2">⚠️ {isZh ? '已开启，创作内容将包含成人描写' : 'Enabled, content will include adult material'}</p>
                      )}
                    </section>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-white/5">
                <button onClick={handleCreate} disabled={loading || selectedGenres.length === 0}
                  className="w-full py-4 rounded-2xl text-base font-bold bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 text-white transition-all shadow-lg shadow-green-900/20 hover:shadow-green-900/40 hover:scale-[1.01] active:scale-[0.99]">
                  {loading ? <span className="flex items-center justify-center gap-2"><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {isZh ? '正在创建...' : 'Creating...'}</span> : (isZh ? '✨ 开始创作' : '✨ Start Creating')}
                </button>
              </div>
            </div>
          )}

          {/* Step: 创作方案 */}
          {step === 'plan' && (
            <div className="space-y-8 animate-fade-in">
              {/* 竞技模式：Top 10 方案卡片 */}
              {project?.config?.arenaMode && arenaCandidates['creative_plan']?.length > 0 && (
                <div className="space-y-4 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚔️</span>
                    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">{isZh ? '竞技结果：Top 10 创意方案' : 'Arena: Top 10 Plans'}</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {arenaCandidates['creative_plan'].map((c: any, i: number) => (
                      <div key={c.id} className={`p-4 rounded-xl border transition-all cursor-pointer ${c.selected ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-[#161616] border-white/5 hover:border-cyan-500/30'}`}
                        onClick={() => handleArenaSelect('creative_plan', c.id)}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-cyan-400">#{c.rank || i + 1}</span>
                            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px]">{c.systemAgentName}</span>
                          </div>
                          <span className="text-sm font-bold text-white">{(c.score || 0).toFixed(1)}</span>
                        </div>
                        {c.content?.titleOptions?.[0] && (
                          <div className="text-sm font-medium text-white mb-1">{c.content.titleOptions[0].title}</div>
                        )}
                        {c.content?.storyLine && (
                          <p className="text-[11px] text-gray-400 line-clamp-2">{c.content.storyLine}</p>
                        )}
                        {c.selected && <div className="text-[10px] text-cyan-400 mt-2">✓ {isZh ? '已选择' : 'Selected'}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!project?.creativePlan ? (
                project?.config?.arenaMode ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-black">
                      <span className="text-4xl">⚔️</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{isZh ? '竞技模式运行中' : 'Arena Running'}</h3>
                    <p className="text-gray-500 mb-6 text-center max-w-md">{isZh ? '多Agent竞技创作正在后台自动执行，全部阶段将串联完成。你可以返回项目列表开始新项目。' : 'Arena mode is running all stages automatically in the background.'}</p>
                    <div className="flex gap-3">
                      <button onClick={() => {
                        fetch('/api/screenplay/list').then(r => r.json()).then(d => {
                          if (d?.projects) setExistingProjects(d.projects.filter((p: ScreenplayProject) => p.status !== 'exported'));
                        }).catch(() => {});
                        setProject(null); setStep('config'); setTaskId(null); setLoading(false);
                        setError(''); setSubmissionData(null);
                      }}
                        className="px-6 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-white font-medium hover:bg-[#222] transition-colors">
                        📂 {isZh ? '返回项目列表' : 'Back to Projects'}
                      </button>
                    </div>
                  </div>
                ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-black">
                    <span className="text-4xl">📋</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{isZh ? '生成创作方案' : 'Generate Plan'}</h3>
                  <p className="text-gray-500 mb-8 text-center max-w-md">{isZh ? 'AI 将基于你的配置，生成包含故事线、人物关系、四幕结构和爽点设计的完整方案。' : 'AI will generate a complete creative plan including storyline, characters, and structure.'}</p>
                  <button onClick={handleGeneratePlan} disabled={loading}
                    className="px-8 py-3.5 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-105">
                    {isZh ? '开始生成' : 'Generate Now'}
                  </button>
                </div>
                )
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* 左侧：核心信息 */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '剧名方案' : 'Titles'}</h3>
                      <div className="grid grid-cols-1 gap-3">
                        {project.creativePlan.titleOptions.map((t, i) => (
                          <div key={i} onClick={() => handleSelectTitle(t.title)}
                            className={`p-4 rounded-xl border cursor-pointer transition-all ${
                              project.selectedTitle === t.title ? 'bg-green-900/20 border-green-500/50' : 'bg-[#0a0a0a] border-white/5 hover:border-white/20'
                            }`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`font-bold ${project.selectedTitle === t.title ? 'text-green-400' : 'text-white'}`}>{t.title}</span>
                              {project.selectedTitle === t.title && <CheckIcon className="w-4 h-4 text-green-400" />}
                            </div>
                            <p className="text-xs text-gray-500">{t.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '故事核心' : 'Core Story'}</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{isZh ? '故事线' : 'Logline'}</div>
                          <p className="text-sm text-gray-200 leading-relaxed">{project.creativePlan.storyLine}</p>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{isZh ? '核心冲突' : 'Conflict'}</div>
                          <p className="text-sm text-gray-200 leading-relaxed">{project.creativePlan.coreConflict}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '四幕结构' : 'Structure'}</h3>
                      <div className="space-y-6 relative">
                        <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-white/5" />
                        {(() => {
                          const plan = project.creativePlan!;
                          // 兼容旧数据：threeActs → fourActs
                          const acts = plan.fourActs ?? (plan as any).threeActs;
                          if (!acts) return null;
                          const actKeys = acts.act4 ? ['act1', 'act2', 'act3', 'act4'] as const : ['act1', 'act2', 'act3'] as const;
                          const labels4 = [isZh ? '第一幕 · 起' : 'Act 1', isZh ? '第二幕 · 承' : 'Act 2', isZh ? '第三幕 · 转' : 'Act 3', isZh ? '第四幕 · 合' : 'Act 4'];
                          const labels3 = [isZh ? '第一幕 · 建置' : 'Act 1', isZh ? '第二幕 · 对抗' : 'Act 2', isZh ? '第三幕 · 高潮' : 'Act 3'];
                          const labels = acts.act4 ? labels4 : labels3;
                          const colors = ['text-blue-400', 'text-yellow-400', 'text-red-400', 'text-green-400'];
                          const borders = ['border-blue-500', 'border-yellow-500', 'border-red-500', 'border-green-500'];
                          return actKeys.map((act, i) => {
                            const a = acts[act];
                            if (!a) return null;
                            return (
                              <div key={act} className="relative pl-10">
                                <div className={`absolute left-[11px] top-1 w-2.5 h-2.5 rounded-full bg-[#161616] border-2 ${borders[i]}`} />
                                <div className={`text-xs font-bold mb-1 ${colors[i]}`}>{labels[i]} <span className="opacity-50 font-normal ml-2">{a.episodeRange}</span></div>
                                <div className="text-sm text-gray-300">
                                  {'coreEvents' in a && (a as any).coreEvents.join(' → ')}
                                  {'conflicts' in a && (a as any).conflicts.join(' → ')}
                                  {'climax' in a && (a as any).climax}
                                  {'ending' in a && (a as any).ending}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* 右侧：设定与数据 */}
                  <div className="space-y-6">
                    <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '世界观设定' : 'World Setting'}</h3>
                      <div className="space-y-3">
                        {Object.entries(project.creativePlan.setting).map(([k, v]) => (
                          <div key={k} className="flex flex-col">
                            <span className="text-[10px] text-gray-500 uppercase">{k}</span>
                            <span className="text-sm text-gray-200">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '爽点分布' : 'Satisfaction'}</h3>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(project.creativePlan.satisfactionMatrix).map(([k, v]) => (
                          <div key={k} className="px-3 py-1.5 rounded-lg bg-[#0a0a0a] border border-white/5 flex items-center gap-2">
                            <span className="text-xs text-gray-300">{k}</span>
                            <div className="h-1 w-12 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500" style={{ width: `${v}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button onClick={() => setStep('characters')} disabled={loading}
                      className="w-full py-4 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02]">
                      {isZh ? '下一步：角色开发 →' : 'Next: Characters →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: 角色开发 */}
          {step === 'characters' && (
            <div className="space-y-8 animate-fade-in">
              {/* 竞技模式：最佳角色设计 */}
              {project?.config?.arenaMode && arenaCandidates['character']?.length > 0 && (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">⚔️</span>
                      <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">{isZh ? '竞技结果：最佳角色设计' : 'Arena: Best Characters'}</h3>
                    </div>
                    <button onClick={() => setShowAlternatives(!showAlternatives)}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">
                      {showAlternatives ? (isZh ? '收起候选' : 'Hide') : (isZh ? '查看其他候选' : 'Show Alternatives')}
                    </button>
                  </div>
                  {showAlternatives && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                      {arenaCandidates['character'].map((c: any, i: number) => (
                        <div key={c.id} className={`p-3 rounded-xl border transition-all cursor-pointer ${c.selected ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-[#161616] border-white/5 hover:border-cyan-500/30'}`}
                          onClick={() => handleArenaSelect('character', c.id)}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-cyan-400">#{c.rank || i + 1}</span>
                              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px]">{c.systemAgentName}</span>
                            </div>
                            <span className="text-sm font-bold text-white">{(c.score || 0).toFixed(1)}</span>
                          </div>
                          {c.content?.characters && (
                            <p className="text-[10px] text-gray-400">{c.content.characters.length} {isZh ? '个角色' : 'characters'}</p>
                          )}
                          {c.characterPoolIds?.length > 0 && (
                            <span className="text-[9px] text-amber-400">🎭 {isZh ? `${c.characterPoolIds.length}个群演角色` : `${c.characterPoolIds.length} from pool`}</span>
                          )}
                          {c.selected && <div className="text-[10px] text-cyan-400 mt-1">✓ {isZh ? '已选择' : 'Selected'}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!project?.characterDesign ? (
                project?.config?.arenaMode ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-black">
                      <span className="text-4xl">⚔️</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{isZh ? '竞技模式运行中' : 'Arena Running'}</h3>
                    <p className="text-gray-500 mb-6 text-center max-w-md">{isZh ? '角色开发阶段正在竞技中，请查看上方日志了解进度。' : 'Character design arena is running.'}</p>
                  </div>
                ) : (
                <div className="space-y-8">
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-black">
                      <span className="text-4xl">👥</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{isZh ? '角色设计' : 'Design Characters'}</h3>
                    <p className="text-gray-500 mb-8 text-center max-w-md">{isZh ? 'AI 将构建完整的人物小传、性格特征、反派体系以及人物关系网。' : 'AI will design character profiles, villains, and relationship networks.'}</p>
                    <button onClick={handleGenerateCharacters} disabled={loading}
                      className="px-8 py-3.5 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-105">
                      {isZh ? '生成角色' : 'Generate Characters'}
                    </button>
                  </div>
                  {/* 世界观模拟实况面板 */}
                  {hasSimLogs && <SimulationPanel logs={simPanelLogs} />}
                </div>
                )
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {project.characterDesign.characters.map(char => (
                      <div key={char.id} className="bg-[#161616] rounded-2xl border border-white/5 overflow-hidden group hover:border-white/20 transition-all">
                        <div className="h-24 bg-gradient-to-br from-gray-800 to-black relative p-5">
                          <div className="absolute top-4 right-4 text-4xl opacity-10">
                            {char.villainLayer ? '👿' : '👤'}
                          </div>
                          <div className="relative z-10">
                            <h3 className="text-xl font-bold text-white">{char.name}</h3>
                            <div className="text-xs text-gray-400 mt-1">{char.age} · {char.publicIdentity}</div>
                          </div>
                        </div>
                        <div className="p-5 space-y-4">
                          {char.villainLayer ? (
                            <div className="inline-block px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                              {isZh ? `反派等级 L${char.villainLayer}` : `Villain L${char.villainLayer}`}
                            </div>
                          ) : null}
                          <div className="space-y-2">
                            <div className="text-xs text-gray-500 uppercase tracking-wider">{isZh ? '性格' : 'Personality'}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {char.personality.map((p, i) => (
                                <span key={i} className="px-2 py-1 rounded bg-[#0a0a0a] border border-white/5 text-xs text-gray-300">{p}</span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{isZh ? '动机' : 'Motivation'}</div>
                            <p className="text-sm text-gray-300 leading-relaxed">{char.motivation}</p>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{isZh ? '人物弧光' : 'Arc'}</div>
                            <p className="text-xs text-gray-400 leading-relaxed">{char.arc}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 世界观模拟回看 */}
                  {hasSimLogs && <SimulationPanel logs={simPanelLogs} />}

                  <div className="flex justify-end pt-6 border-t border-white/5">
                    <button onClick={() => setStep('directory')} disabled={loading}
                      className="px-8 py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02]">
                      {isZh ? '下一步：分集目录 →' : 'Next: Directory →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: 分集目录 */}
          {step === 'directory' && (
            <div className="space-y-8 animate-fade-in">
              {/* 竞技模式：Top 5 分集目录 */}
              {project?.config?.arenaMode && arenaCandidates['directory']?.length > 0 && (
                <div className="mb-2 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚔️</span>
                    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">{isZh ? '竞技结果：Top 5 分集目录' : 'Arena: Top 5 Directories'}</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {arenaCandidates['directory'].map((c: any, i: number) => (
                      <div key={c.id} className={`p-4 rounded-xl border transition-all cursor-pointer ${c.selected ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-[#161616] border-white/5 hover:border-cyan-500/30'}`}
                        onClick={() => handleArenaSelect('directory', c.id)}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-cyan-400">#{c.rank || i + 1}</span>
                            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px]">{c.systemAgentName}</span>
                          </div>
                          <span className="text-sm font-bold text-white">{(c.score || 0).toFixed(1)}</span>
                        </div>
                        {Array.isArray(c.content) && (
                          <div className="flex gap-3 text-[10px] text-gray-400">
                            <span>{c.content.length} {isZh ? '集' : 'eps'}</span>
                            <span>🔥 {c.content.filter((d: any) => d.mark === '🔥').length}</span>
                            <span>💰 {c.content.filter((d: any) => d.mark === '💰').length}</span>
                          </div>
                        )}
                        {c.selected && <div className="text-[10px] text-cyan-400 mt-1">✓ {isZh ? '已选择' : 'Selected'}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!project?.episodeDirectory ? (
                project?.config?.arenaMode ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-black">
                      <span className="text-4xl">⚔️</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{isZh ? '竞技模式运行中' : 'Arena Running'}</h3>
                    <p className="text-gray-500 mb-6 text-center max-w-md">{isZh ? '分集目录阶段正在竞技中，请查看上方日志了解进度。' : 'Directory arena is running.'}</p>
                  </div>
                ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-black">
                    <span className="text-4xl">📑</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{isZh ? '规划分集目录' : 'Plan Episodes'}</h3>
                  <p className="text-gray-500 mb-8 text-center max-w-md">{isZh ? 'AI 将规划全剧的节奏、钩子和付费点，生成详细的分集大纲。' : 'AI will plan the rhythm, hooks, and paywalls for all episodes.'}</p>
                  <button onClick={handleGenerateDirectory} disabled={loading}
                    className="px-8 py-3.5 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-105">
                    {isZh ? '生成目录' : 'Generate Directory'}
                  </button>
                </div>
                )
              ) : (
                <div className="space-y-6">
                  {/* 统计栏 */}
                  <div className="flex gap-4 p-4 bg-[#161616] rounded-xl border border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-white">{project.episodeDirectory.length}</span>
                      <span className="text-xs text-gray-500 uppercase">{isZh ? '总集数' : 'Episodes'}</span>
                    </div>
                    <div className="w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-red-400">{project.episodeDirectory.filter(d => d.mark === '🔥').length}</span>
                      <span className="text-xs text-gray-500 uppercase">{isZh ? '爆点' : 'Climax'}</span>
                    </div>
                    <div className="w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-yellow-400">{project.episodeDirectory.filter(d => d.mark === '💰').length}</span>
                      <span className="text-xs text-gray-500 uppercase">{isZh ? '付费点' : 'Paywall'}</span>
                    </div>
                  </div>

                  {/* 目录列表 */}
                  <div className="space-y-2">
                    {project.episodeDirectory.map(d => (
                      <div key={d.number} className="flex items-center gap-4 p-4 rounded-xl bg-[#161616] border border-white/5 hover:border-white/10 transition-all group">
                        <div className="w-12 text-center">
                          <div className="text-sm font-bold text-gray-500 group-hover:text-white transition-colors">#{d.number}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-medium text-white truncate">{d.title}</h4>
                            {d.mark === '🔥' && <span className="text-xs">🔥</span>}
                            {d.mark === '💰' && <span className="text-xs">💰</span>}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              d.phase.includes('起势') ? 'bg-blue-500/10 text-blue-400' :
                              d.phase.includes('攀升') ? 'bg-green-500/10 text-green-400' :
                              d.phase.includes('高潮') || d.phase.includes('风暴') ? 'bg-red-500/10 text-red-400' :
                              'bg-gray-500/10 text-gray-400'
                            }`}>{d.phase}</span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{d.summary}</p>
                        </div>
                        <div className="text-xs text-gray-600 font-mono">{d.hookType}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end pt-6 border-t border-white/5">
                    <button onClick={() => { setStep('writing'); setWritingRange({ start: 1, end: Math.min(5, project.config.totalEpisodes) }); }} disabled={loading}
                      className="px-8 py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02]">
                      {isZh ? '确认目录，开始撰写 →' : 'Start Writing →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: 分集撰写 */}
          {step === 'writing' && (
            <div className="space-y-8 animate-fade-in">
              {/* 竞技模式：Top 3 剧本 */}
              {project?.config?.arenaMode && arenaCandidates['episode']?.length > 0 && (
                <div className="mb-2 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚔️</span>
                    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">{isZh ? '竞技结果：Top 3 剧本' : 'Arena: Top 3 Screenplays'}</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {arenaCandidates['episode'].map((c: any, i: number) => (
                      <div key={c.id} className={`p-4 rounded-xl border transition-all cursor-pointer ${c.selected ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-[#161616] border-white/5 hover:border-cyan-500/30'}`}
                        onClick={() => handleArenaSelect('episode', c.id)}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-lg font-bold ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : 'text-amber-600'}`}>
                              {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px]">{c.systemAgentName}{isZh ? '风格出品' : ' Style'}</span>
                          </div>
                          <span className="text-lg font-bold text-white">{(c.score || 0).toFixed(1)}</span>
                        </div>
                        {c.directionScores && (
                          <div className="space-y-1 mb-3">
                            {(c.directionScores as any[]).slice(0, 5).map((ds: any) => (
                              <div key={ds.directionId} className="flex items-center gap-2">
                                <span className="text-[9px] text-gray-500 w-16 truncate">{ds.directionName}</span>
                                <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-cyan-500/60 rounded-full" style={{ width: `${(ds.medianScore / 10) * 100}%` }} />
                                </div>
                                <span className="text-[9px] text-gray-400 w-6 text-right">{ds.medianScore?.toFixed(1)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {c.content?.episodes && (
                          <p className="text-[10px] text-gray-400">{c.content.episodes.length} {isZh ? '集完整剧本' : 'episodes'}</p>
                        )}
                        {c.selected && <div className="text-[10px] text-cyan-400 mt-2">✓ {isZh ? '已选择为正式剧本' : 'Selected as final'}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 控制栏 */}
              <div className="bg-[#161616] p-6 rounded-2xl border border-white/5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">{isZh ? '批量撰写' : 'Batch Write'}</h3>
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    <span>{isZh ? '范围：' : 'Range:'}</span>
                    <div className="flex items-center bg-[#0a0a0a] rounded-lg border border-white/10 px-2">
                      <input type="number" value={writingRange.start} onChange={e => setWritingRange(prev => ({ ...prev, start: Number(e.target.value) }))}
                        className="w-12 bg-transparent text-center py-1.5 outline-none text-white" />
                      <span className="text-gray-600">-</span>
                      <input type="number" value={writingRange.end} onChange={e => setWritingRange(prev => ({ ...prev, end: Number(e.target.value) }))}
                        className="w-12 bg-transparent text-center py-1.5 outline-none text-white" />
                    </div>
                    <button onClick={handleWriteEpisodes} disabled={loading}
                      className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium transition-colors">
                      {isZh ? '生成' : 'Generate'}
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-white">{project?.episodes.length || 0} <span className="text-sm font-normal text-gray-500">/ {project?.config.totalEpisodes}</span></div>
                  <div className="text-xs text-gray-500">{isZh ? '已完成集数' : 'Episodes Completed'}</div>
                  {project?.episodeDirectory && project.episodes.length < project.episodeDirectory.length && (
                    <button onClick={handleRetryFailed} disabled={loading}
                      className="mt-2 px-3 py-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                      {loading
                        ? (isZh ? '重试中...' : 'Retrying...')
                        : (isZh ? `重试失败分集 (${project.episodeDirectory.length - project.episodes.length}集)` : `Retry Failed (${project.episodeDirectory.length - project.episodes.length})`)}
                    </button>
                  )}
                </div>
              </div>

              {/* 集列表 */}
              {project?.episodes && project.episodes.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...project.episodes].sort((a, b) => a.number - b.number).map((ep, idx) => (
                    <div key={ep.number ?? `ep-${idx}`} onClick={() => setSelectedEpisode(selectedEpisode === ep.number ? null : ep.number)}
                      className={`cursor-pointer rounded-xl border transition-all p-4 hover:scale-[1.02] ${
                        selectedEpisode === ep.number ? 'bg-[#1a1a1a] border-green-500/50 shadow-lg shadow-green-900/10' : 'bg-[#161616] border-white/5 hover:border-white/20'
                      }`}>
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-mono text-green-400">EP.{String(ep.number).padStart(2, '0')}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{ep.phase}</span>
                      </div>
                      <h4 className="text-sm font-bold text-white mb-2 line-clamp-1">{ep.title}</h4>
                      <p className="text-xs text-gray-500 line-clamp-2 mb-3">{ep.previousRecap || '暂无摘要'}</p>
                      <div className="flex gap-1 flex-wrap">
                        {(ep.keywords || []).slice(0, 3).map((k, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0a0a0a] text-gray-400 border border-white/5">{k}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 选中集详情 */}
              {selectedEpisode && project?.episodes.find(e => e.number === selectedEpisode) && (() => {
                const ep = project.episodes.find(e => e.number === selectedEpisode)!;
                return (
                  <div className="fixed inset-0 z-[60] flex justify-end">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedEpisode(null)} />
                    <div className="relative w-full max-w-2xl bg-[#111] h-full shadow-2xl border-l border-white/10 flex flex-col animate-slide-in-right">
                      <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#111]/95 backdrop-blur">
                        <div>
                          <h3 className="text-lg font-bold text-white">{ep.title}</h3>
                          <div className="text-xs text-gray-500 mt-1">第 {ep.number} 集 · {ep.scenes.length} 场戏</div>
                        </div>
                        <button onClick={() => setSelectedEpisode(null)} className="p-2 hover:bg-white/10 rounded-lg text-gray-400"><CloseIcon className="w-5 h-5" /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                        {ep.scenes.map((scene, i) => (
                          <div key={i} className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-mono text-gray-500 bg-[#1a1a1a] px-3 py-1.5 rounded-lg w-fit">
                              <span className="text-green-400">SCENE {scene.sceneNumber}</span>
                              <span>{scene.location}</span>
                              <span>·</span>
                              <span>{scene.characters.join(', ')}</span>
                            </div>
                            <p className="text-sm text-gray-300 leading-relaxed pl-1">{scene.description}</p>
                            <div className="space-y-3 pl-4 border-l-2 border-white/5 mt-3">
                              {scene.dialogues.map((d, di) => (
                                <div key={di} className="text-sm">
                                  <span className="font-bold text-gray-200">{d.character}</span>
                                  {d.direction && <span className="text-gray-500 text-xs mx-1">({d.direction})</span>}
                                  <span className="text-gray-400">：{d.line}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-4 pt-6 border-t border-white/5">
                <button onClick={() => setStep('review')}
                  className="px-6 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-white font-medium hover:bg-[#222] transition-colors">
                  {isZh ? '进入质量自检' : 'Quality Review'}
                </button>
                <button onClick={() => handleSubmission()}
                  className="px-8 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all">
                  {isZh ? '生成投稿包' : 'Generate Submission'}
                </button>
              </div>
            </div>
          )}

          {/* Step: 质量自检 */}
          {step === 'review' && (
            <div className="space-y-8 animate-fade-in">
              <div className="flex items-center justify-between bg-[#161616] p-6 rounded-2xl border border-white/5">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1">{isZh ? 'AI 质量自检' : 'AI Quality Review'}</h2>
                  <p className="text-sm text-gray-500">{isZh ? '从节奏、爽点、台词等多维度评估并优化剧本' : 'Evaluate and optimize script from multiple dimensions'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const reviewedCount = project?.episodes?.filter(ep => project.reviews[ep.number])?.length || 0;
                    const totalEps = project?.episodes?.length || 0;
                    const hasPartial = reviewedCount > 0 && reviewedCount < totalEps;
                    return <>
                      {hasPartial && !reviewAllTaskId && (
                        <button onClick={() => handleReviewAll(true)} disabled={!!reviewAllTaskId}
                          className="px-4 py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold shadow-lg transition-all flex items-center gap-2 text-sm">
                          <span>▶</span>
                          {isZh ? `继续优化 (${totalEps - reviewedCount}集)` : `Continue (${totalEps - reviewedCount})`}
                        </button>
                      )}
                      <button onClick={() => handleReviewAll(false)} disabled={!!reviewAllTaskId || !totalEps}
                        className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-purple-900/20 transition-all flex items-center gap-2">
                        <SparkleIcon className="w-4 h-4" />
                        {reviewAllTaskId ? (isZh ? '正在优化...' : 'Optimizing...') : (isZh ? '一键全剧优化' : 'Optimize All')}
                      </button>
                    </>;
                  })()}
                </div>
              </div>

              {reviewAllTaskId && reviewAllTotal > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{reviewAllProgress || 'Processing...'}</span>
                    <span>{Math.round((reviewAllDone / reviewAllTotal) * 100)}%</span>
                  </div>
                  <div className="w-full bg-[#161616] rounded-full h-2 overflow-hidden">
                    <div className="bg-purple-500 h-2 rounded-full transition-all duration-500" style={{ width: `${(reviewAllDone / reviewAllTotal) * 100}%` }} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {/* 优先使用分集目录（完整集数列表），回退到已撰写集 */}
                {(project?.episodeDirectory || project?.episodes)?.map(item => {
                  const epNum = item.number;
                  if (epNum == null) return null;
                  const hasScript = project!.episodes.some(e => e.number === epNum);
                  const review = project!.reviews[epNum];
                  const score = review?.total || 0;
                  const color = score >= 45 ? 'text-green-400' : score >= 35 ? 'text-yellow-400' : score > 0 ? 'text-red-400' : 'text-gray-600';
                  return (
                    <div key={epNum} onClick={() => review && setReviewDetailEp(epNum)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer group relative ${
                        hasScript ? 'bg-[#161616] border-white/5 hover:border-white/20' : 'bg-[#0e0e0e] border-white/3 opacity-50'
                      }`}>
                      <div className="text-xs text-gray-500 mb-1">EP.{epNum}</div>
                      <div className={`text-2xl font-bold ${hasScript ? color : 'text-gray-700'}`}>
                        {score > 0 ? score : hasScript ? '-' : '·'}
                      </div>
                      {score > 0 && <div className="text-[10px] text-gray-600 mt-1">{isZh ? '点击查看详情' : 'View details'}</div>}
                      {!hasScript && <div className="text-[10px] text-gray-700 mt-1">{isZh ? '未撰写' : 'Not written'}</div>}
                      {/* 已撰写但未评审：显示单集自检按钮 */}
                      {hasScript && !review && (
                        <button onClick={(e) => { e.stopPropagation(); handleReview(epNum); }}
                          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl text-xs text-white font-medium">
                          {reviewingEp === epNum ? (isZh ? '自检中...' : 'Reviewing...') : (isZh ? '单集自检' : 'Review')}
                        </button>
                      )}
                      {/* 已评审：hover 显示重新自检按钮 */}
                      {hasScript && review && (
                        <button onClick={(e) => { e.stopPropagation(); handleReview(epNum); }}
                          disabled={reviewingEp === epNum}
                          className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-lg bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white hover:bg-white/10"
                          title={isZh ? '重新自检' : 'Re-review'}>
                          {reviewingEp === epNum ? <span className="animate-spin text-[10px]">⏳</span> : <span className="text-xs">↻</span>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 下一步按钮 */}
              {project?.episodes?.some(ep => project.reviews[ep.number]) && (
                <div className="flex justify-end pt-4">
                  <button onClick={() => { handleSubmission(); }}
                    className="px-8 py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02] flex items-center gap-2">
                    <CheckIcon className="w-4 h-4" />
                    {isZh ? '下一步：投稿 →' : 'Next: Submit →'}
                  </button>
                </div>
              )}

            </div>
          )}

          {/* Step: 投稿 */}
          {step === 'submission' && (
            <div className="space-y-6 animate-fade-in">
              {/* 头部 */}
              <div className="flex items-center justify-between bg-[#161616] p-6 rounded-2xl border border-white/5">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1">{isZh ? '📦 投稿材料' : '📦 Submission Pack'}</h2>
                  <p className="text-sm text-gray-500">{isZh ? '一键生成平台投稿所需的全部材料' : 'Generate all materials for platform submission'}</p>
                </div>
                <div className="flex gap-3">
                  {!submissionData && (
                    <button onClick={() => handleSubmission()} disabled={loading}
                      className="px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold transition-all flex items-center gap-2">
                      <SparkleIcon className="w-4 h-4" />
                      {loading ? (isZh ? '生成中...' : 'Generating...') : (isZh ? '一键生成投稿包' : 'Generate All')}
                    </button>
                  )}
                  {submissionData && (
                    <>
                      <button onClick={() => handleSubmission(true)} disabled={loading}
                        className="px-5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 hover:bg-[#222] text-white font-medium transition-all flex items-center gap-2 disabled:opacity-50">
                        <SparkleIcon className="w-4 h-4" />
                        {loading ? (isZh ? '生成中...' : 'Regenerating...') : (isZh ? '重新生成' : 'Regenerate')}
                      </button>
                      <button onClick={handleDownloadAll}
                        className="px-5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 hover:bg-[#222] text-white font-medium transition-all flex items-center gap-2">
                        <DownloadIcon className="w-4 h-4" />
                        {isZh ? '下载全部' : 'Download All'}
                      </button>
                      <button onClick={onClose}
                        className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-all flex items-center gap-2">
                        <FilmIcon className="w-4 h-4" />
                        {isZh ? '去制作视频' : 'Make Video'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Tab 切换 */}
              {submissionData && (() => {
                const tabs: Array<{ key: typeof submissionTab; label: string; icon: string }> = [
                  { key: 'outline', label: isZh ? '集纲' : 'Episode Outline', icon: '📋' },
                  { key: 'ecard', label: 'E-card', icon: '🎴' },
                  { key: 'bios', label: isZh ? '人物小传' : 'Character Bios', icon: '👤' },
                  { key: 'synopsis', label: isZh ? '剧本大纲' : 'Synopsis', icon: '📖' },
                ];
                const contentMap: Record<typeof submissionTab, { content: string; suffix: string }> = {
                  outline: { content: submissionData.episodeOutline, suffix: '集纲' },
                  ecard: { content: submissionData.ecard, suffix: 'E-card' },
                  bios: { content: submissionData.characterBios, suffix: '人物小传' },
                  synopsis: { content: submissionData.scriptSynopsis, suffix: '剧本大纲' },
                };
                const current = contentMap[submissionTab];
                return (
                  <>
                    <div className="flex gap-2 bg-[#111] p-1.5 rounded-xl border border-white/5">
                      {tabs.map(t => (
                        <button key={t.key} onClick={() => setSubmissionTab(t.key)}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                            submissionTab === t.key ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                          }`}>
                          <span>{t.icon}</span>
                          <span>{t.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* 内容预览 + 下载 */}
                    <div className="bg-[#161616] rounded-2xl border border-white/5 overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                        <span className="text-sm text-gray-400">{tabs.find(t => t.key === submissionTab)?.icon} {tabs.find(t => t.key === submissionTab)?.label}</span>
                        <button onClick={() => handleDownloadMaterial(current.content, current.suffix)}
                          className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1">
                          <DownloadIcon className="w-3 h-3" />
                          {isZh ? '下载' : 'Download'}
                        </button>
                      </div>
                      <div className="p-6 max-h-[50vh] overflow-y-auto custom-scrollbar">
                        <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">{current.content}</pre>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* 未生成时的占位 */}
              {!submissionData && !loading && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                  <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <BookIcon className="w-8 h-8 text-gray-600" />
                  </div>
                  <p className="text-sm">{isZh ? '点击上方按钮生成投稿材料' : 'Click the button above to generate submission materials'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 审核详情弹窗 - 放在最外层避免被 overflow 容器裁剪 */}
      {reviewDetailEp && project?.reviews[reviewDetailEp] && (() => {
        const review = project.reviews[reviewDetailEp];
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setReviewDetailEp(null)} />
            <div className="relative w-full max-w-2xl bg-[#111] rounded-2xl border border-white/10 shadow-2xl max-h-[85vh] flex flex-col animate-scale-in">
              <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">第 {reviewDetailEp} 集评估报告</h3>
                <div className="text-2xl font-bold text-green-400">{review.total}分</div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(review).filter(([k]) => k !== 'total' && k !== 'issues').map(([k, v]: [string, any]) => (
                    <div key={k} className="bg-[#1a1a1a] p-3 rounded-lg text-center">
                      <div className="text-[10px] text-gray-500 uppercase mb-1">{k}</div>
                      <div className="text-lg font-bold text-white">{v.score}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-white">问题与建议</h4>
                  {review.issues.map((issue, i) => (
                    <div key={i} className="p-4 rounded-xl bg-[#1a1a1a] border border-white/5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${issue.severity === '严重' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{issue.severity}</span>
                        <span className="text-sm text-gray-300">{issue.description}</span>
                      </div>
                      <p className="text-xs text-gray-500 pl-1 border-l-2 border-white/10 ml-1 mt-2">{issue.suggestion}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
