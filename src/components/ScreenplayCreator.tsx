// 剧本创建向导组件 - 基于 short-drama 方法论的多步骤创作流程
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// 类型定义（与后端对齐）
// ============================================================

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
}

interface CreativePlan {
  titleOptions: Array<{ title: string; description: string }>;
  setting: { era: string; location: string; socialEnv: string; classRelation: string };
  storyLine: string;
  coreConflict: string;
  threeActs: {
    act1: { episodeRange: string; coreEvents: string[]; relationships: string };
    act2: { episodeRange: string; conflicts: string[]; turningPoints: string[] };
    act3: { episodeRange: string; climax: string; ending: string };
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
  createdAt: number;
  updatedAt: number;
}

interface GenreItem { key: string; name: string; desc: string; audience: string; }

interface ScreenplayCreatorProps {
  onClose: () => void;
  onProjectCreated?: (projectId: string) => void;
  resumeProjectId?: string | null;
}

type Step = 'config' | 'plan' | 'characters' | 'directory' | 'writing' | 'review' | 'export';
const STEPS: Step[] = ['config', 'plan', 'characters', 'directory', 'writing', 'review', 'export'];

const STEP_LABELS: Record<Step, { zh: string; en: string }> = {
  config: { zh: '选题定位', en: 'Setup' },
  plan: { zh: '创作方案', en: 'Plan' },
  characters: { zh: '角色开发', en: 'Characters' },
  directory: { zh: '分集目录', en: 'Directory' },
  writing: { zh: '分集撰写', en: 'Writing' },
  review: { zh: '质量自检', en: 'Review' },
  export: { zh: '导出', en: 'Export' },
};

const TONES = ['爽燃', '甜虐', '搞笑', '暗黑', '温情', '甜宠'];
const ENDINGS = [
  { value: 'HE', label: '大团圆 (HE)' },
  { value: 'BE', label: '悲剧 (BE)' },
  { value: 'OE', label: '开放式 (OE)' },
  { value: '反转式', label: '反转式' },
];
const EPISODE_PRESETS = [50, 60, 80, 100];

// ============================================================
// WebSocket 进度监听 Hook
// ============================================================

function useTaskProgress(taskId: string | null, onDone: () => void) {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!taskId) return;
    setLogs([]); setError('');
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
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);
  return (
    <div className="rounded-xl bg-[#0d0d0d] border border-blue-500/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-blue-500/5 border-b border-blue-500/10">
        <span className="text-xs text-blue-400">📋 实时日志</span>
        <span className="text-[10px] text-gray-600">{logs.length} 条</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar p-3 space-y-1 font-mono">
        {logs.map((log, i) => (
          <div key={i} className="text-xs text-gray-400 leading-relaxed">
            <span className="text-gray-600 mr-2">{String(i + 1).padStart(2, '0')}</span>
            {log}
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

export default function ScreenplayCreator({ onClose, onProjectCreated: _onProjectCreated, resumeProjectId }: ScreenplayCreatorProps) {
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
  const [totalEpisodes, setTotalEpisodes] = useState(60);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; genre: string; tone: string; score: number; sourceNovel: string }>>([]);
  const [referenceNovel, setReferenceNovel] = useState('');
  const novelFileRef = useRef<HTMLInputElement>(null);

  // 分集撰写
  const [writingRange, setWritingRange] = useState({ start: 1, end: 5 });
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [reviewingEp, setReviewingEp] = useState<number | null>(null);
  const [exportContent, setExportContent] = useState('');
  const [existingProjects, setExistingProjects] = useState<ScreenplayProject[]>([]);

  // 规范化项目数据（DB恢复后字段可能是JSON字符串而非对象）
  const normalizeProject = (p: ScreenplayProject): ScreenplayProject => {
    const parseIfString = <T,>(val: T | string | undefined | null, fallback: T): T => {
      if (val == null) return fallback;
      if (typeof val === 'string') { try { return JSON.parse(val); } catch { return fallback; } }
      return val;
    };
    const episodes = parseIfString(p.episodes, [] as EpisodeScript[]);
    const reviews = parseIfString(p.reviews, {} as Record<number, ReviewScore>);
    const episodeDirectory = parseIfString(p.episodeDirectory, undefined as EpisodeDirectoryItem[] | undefined);
    return {
      ...p,
      episodes: Array.isArray(episodes) ? episodes : [],
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
    // 如果有指定恢复的项目ID，直接加载
    if (resumeProjectId) {
      fetch(`/api/screenplay/${resumeProjectId}`).then(r => r.json()).then(d => {
        if (d?.project) {
          const p = normalizeProject(d.project);
          setProject(p);
          const statusStepMap: Record<string, Step> = {
            config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
            directory_done: 'directory', writing: 'writing', review: 'review', exported: 'export',
          };
          setStep(statusStepMap[p.status] || 'config');
          setExistingProjects([]);
        }
      }).catch(() => {});
    }
  }, []);

  // 用 ref 保持最新 project.id，避免 useCallback 闭包过期
  const projectIdRef = useRef<string | undefined>(project?.id);
  projectIdRef.current = project?.id;

  // 刷新项目数据
  const refreshProject = useCallback(async () => {
    const pid = projectIdRef.current;
    console.log('[refreshProject] called, pid=', pid);
    if (!pid) return;
    try {
      const res = await fetch(`/api/screenplay/${pid}`);
      const data = await res.json();
      console.log('[refreshProject] API response:', data?.project?.status, 'hasDir=', Array.isArray(data?.project?.episodeDirectory), 'dirType=', typeof data?.project?.episodeDirectory);
      if (data?.project) {
        const normalized = normalizeProject(data.project);
        console.log('[refreshProject] normalized hasDir=', Array.isArray(normalized.episodeDirectory), 'dirLen=', normalized.episodeDirectory?.length);
        setProject(normalized);
      }
    } catch (err) { console.error('[refreshProject] error:', err); }
  }, []);

  // WebSocket 进度回调
  const handleTaskDone = useCallback(() => {
    setTaskId(null);
    setLoading(false);
    refreshProject();
  }, [refreshProject]);

  const { logs, error: wsError } = useTaskProgress(taskId, handleTaskDone);

  // 恢复已有项目
  const resumeProject = (p: ScreenplayProject) => {
    setProject(normalizeProject(p));
    const statusStepMap: Record<string, Step> = {
      config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
      directory_done: 'directory', writing: 'writing', review: 'review', exported: 'export',
    };
    setStep(statusStepMap[p.status] || 'config');
    setExistingProjects([]);
  };

  // 题材选择切换
  const toggleGenre = (key: string) => {
    setSelectedGenres(prev =>
      prev.includes(key) ? prev.filter(g => g !== key) : prev.length < 2 ? [...prev, key] : prev
    );
  };

  // ============================================================
  // API 调用
  // ============================================================

  const handleCreate = async () => {
    if (selectedGenres.length === 0) { setError('请至少选择一个题材'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/screenplay/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedGenres, audience, tone, endingType, totalEpisodes, language: 'zh-CN', mode: 'domestic', customPrompt: customPrompt || undefined, agentId: selectedAgentId || undefined, referenceNovel: referenceNovel || undefined }),
      });
      const data = await res.json();
      if (data?.project) { setProject(normalizeProject(data.project)); setStep('plan'); }
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

  const handleExport = async () => {
    if (!project) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/screenplay/${project.id}/export`, { method: 'POST' });
      const data = await res.json();
      if (data?.content) { setExportContent(data.content); setStep('export'); }
      else setError(data?.error || '导出失败');
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

  const handleDownloadExport = () => {
    const title = project?.selectedTitle || project?.creativePlan?.titleOptions?.[0]?.title || '剧本';
    const blob = new Blob([exportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title}-完整剧本.md`; a.click();
    URL.revokeObjectURL(url);
  };

  // 步骤导航（根据项目状态自动跳转）
  useEffect(() => {
    if (!project) return;
    const statusMap: Record<string, Step> = {
      config_done: 'plan', plan_done: 'plan', characters_done: 'characters',
      directory_done: 'directory', writing: 'writing', review: 'review', exported: 'export',
    };
    const targetStep = statusMap[project.status];
    if (targetStep && STEPS.indexOf(targetStep) > STEPS.indexOf(step)) setStep(targetStep);
  }, [project?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // 渲染
  // ============================================================

  const stepIndex = STEPS.indexOf(step);
  const displayError = error || wsError;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-base font-semibold text-white">
            ✍️ {isZh ? '剧本创作' : 'Screenplay Creator'}
            {project?.selectedTitle && <span className="text-gray-400 ml-2">— {project.selectedTitle}</span>}
          </h1>
        </div>
      </header>

      {/* Step Bar */}
      <div className="px-6 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-1 max-w-4xl mx-auto">
          {STEPS.map((s, i) => {
            const isActive = s === step;
            const isDone = i < stepIndex;
            return (
              <div key={s} className="flex items-center flex-1">
                <button
                  onClick={() => isDone && setStep(s)}
                  disabled={!isDone && !isActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors w-full justify-center ${
                    isActive ? 'bg-green-600/20 text-green-400 border border-green-500/30' :
                    isDone ? 'bg-white/5 text-gray-300 hover:bg-white/10 cursor-pointer' :
                    'text-gray-600'
                  }`}
                >
                  {isDone && <span>✓</span>}
                  <span>{isZh ? STEP_LABELS[s].zh : STEP_LABELS[s].en}</span>
                </button>
                {i < STEPS.length - 1 && <div className={`w-4 h-px mx-1 ${isDone ? 'bg-green-500/50' : 'bg-white/10'}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* 进度/错误提示 */}
          {logs.length > 0 && <ProgressLog logs={logs} />}
          {displayError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              {displayError}
            </div>
          )}

          {/* Step: 选题定位 */}
          {step === 'config' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '🎬 选题定位' : '🎬 Setup'}</h2>

              {/* 已有项目恢复 */}
              {existingProjects.length > 0 && (
                <div className="p-4 rounded-xl bg-[#111] border border-amber-500/20 space-y-3">
                  <p className="text-sm text-amber-400">📂 {isZh ? '发现未完成的剧本项目' : 'Unfinished projects found'}</p>
                  {existingProjects.map(p => {
                    const statusLabels: Record<string, string> = {
                      config_done: '待生成方案', plan_done: '待角色开发', characters_done: '待分集目录',
                      directory_done: '待撰写', writing: '撰写中', review: '自检中',
                    };
                    return (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200 truncate">{p.selectedTitle || p.creativePlan?.titleOptions?.[0]?.title || p.config.genres.join('+')}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {isZh ? statusLabels[p.status] || p.status : p.status}
                            {` · ${p.config.totalEpisodes}集`}
                            {p.episodes.length > 0 ? ` · 已写${p.episodes.length}集` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-3">
                          <button onClick={() => resumeProject(p)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                            {isZh ? '继续' : 'Resume'}
                          </button>
                          <button onClick={async () => {
                            await fetch(`/api/screenplay/${p.id}`, { method: 'DELETE' });
                            setExistingProjects(prev => prev.filter(x => x.id !== p.id));
                          }} className="px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            {isZh ? '删除' : 'Del'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t border-white/5 pt-3">
                    <p className="text-xs text-gray-600">{isZh ? '或创建新项目 ↓' : 'Or create a new project ↓'}</p>
                  </div>
                </div>
              )}

              {/* 题材选择 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '题材（最多选2个组合）' : 'Genre (max 2)'}</label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {genres.map(g => (
                    <button key={g.key} onClick={() => toggleGenre(g.key)}
                      className={`p-3 rounded-xl text-left text-sm border transition-colors ${
                        selectedGenres.includes(g.key)
                          ? 'bg-green-600/20 border-green-500/40 text-green-300'
                          : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:border-white/20'
                      }`}>
                      <div className="font-medium">{g.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{g.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 受众 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '目标受众' : 'Audience'}</label>
                <div className="flex gap-2">
                  {(['男频', '女频', '全年龄'] as const).map(a => (
                    <button key={a} onClick={() => setAudience(a)}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        audience === a ? 'bg-green-600/20 border-green-500/40 text-green-300' : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:border-white/20'
                      }`}>{a}</button>
                  ))}
                </div>
              </div>

              {/* 基调 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '故事基调' : 'Tone'}</label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map(t => (
                    <button key={t} onClick={() => setTone(t)}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        tone === t ? 'bg-green-600/20 border-green-500/40 text-green-300' : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:border-white/20'
                      }`}>{t}</button>
                  ))}
                </div>
              </div>

              {/* 结局 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '结局类型' : 'Ending'}</label>
                <div className="flex flex-wrap gap-2">
                  {ENDINGS.map(e => (
                    <button key={e.value} onClick={() => setEndingType(e.value)}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        endingType === e.value ? 'bg-green-600/20 border-green-500/40 text-green-300' : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:border-white/20'
                      }`}>{e.label}</button>
                  ))}
                </div>
              </div>

              {/* 集数 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '集数规模' : 'Episodes'}</label>
                <div className="flex items-center gap-3">
                  {EPISODE_PRESETS.map(n => (
                    <button key={n} onClick={() => setTotalEpisodes(n)}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        totalEpisodes === n ? 'bg-green-600/20 border-green-500/40 text-green-300' : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:border-white/20'
                      }`}>{n}{isZh ? '集' : ' eps'}</button>
                  ))}
                  <input type="number" value={totalEpisodes} onChange={e => setTotalEpisodes(Number(e.target.value))}
                    className="w-20 px-3 py-2 rounded-xl bg-[#1a1a1a] border border-white/10 text-white text-sm" min={20} max={200} />
                </div>
              </div>

              {/* 参考小说（可选） */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '📖 参考小说（可选，基于小说二创改编）' : '📖 Reference Novel (optional)'}</label>
                {referenceNovel ? (
                  <div className="p-3 rounded-xl bg-[#1a1a1a] border border-green-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-green-400">✅ {isZh ? '已上传' : 'Uploaded'} ({referenceNovel.length.toLocaleString()}{isZh ? '字' : ' chars'})</span>
                      <button onClick={() => setReferenceNovel('')} className="text-xs text-gray-500 hover:text-red-400 transition-colors">{isZh ? '移除' : 'Remove'}</button>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{referenceNovel.slice(0, 200)}...</p>
                  </div>
                ) : (
                  <div className="flex gap-3">
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
                    <button onClick={() => novelFileRef.current?.click()}
                      className="px-4 py-2.5 rounded-xl text-sm bg-[#1a1a1a] border border-white/10 text-gray-300 hover:bg-[#222] hover:border-white/20 transition-colors">
                      📁 {isZh ? '上传小说文件' : 'Upload Novel'}
                    </button>
                    <span className="text-xs text-gray-600 self-center">{isZh ? '不上传则为全新原创剧本' : 'Skip for original screenplay'}</span>
                  </div>
                )}
              </div>

              {/* 写作Agent（可选） */}
              {agents.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-400 mb-2">{isZh ? '🤖 写作Agent（可选，来自创作工厂）' : '🤖 Writing Agent (optional)'}</label>
                  <select value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-white text-sm appearance-none cursor-pointer focus:border-green-500/50 focus:outline-none">
                    <option value="">{isZh ? '不使用Agent（默认编剧模式）' : 'No Agent (default mode)'}</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.score ? ` · ${a.score}分` : ''}{a.genre ? ` · ${a.genre}` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedAgentId && (() => {
                    const a = agents.find(x => x.id === selectedAgentId);
                    return a ? (
                      <p className="text-xs text-gray-500 mt-1">
                        {isZh ? `来源：「${a.sourceNovel}」 · 风格：${a.tone || a.genre}` : `Source: "${a.sourceNovel}"`}
                      </p>
                    ) : null;
                  })()}
                </div>
              )}

              {/* 自定义要求 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">{isZh ? '额外创作要求（可选）' : 'Custom Requirements (optional)'}</label>
                <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                  placeholder={isZh ? '例如：主角是一个退伍军人，故事发生在深圳...' : 'e.g. The protagonist is a veteran...'}
                  className="w-full h-24 px-4 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-white text-sm resize-none placeholder-gray-600" />
              </div>

              <button onClick={handleCreate} disabled={loading || selectedGenres.length === 0}
                className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors">
                {isZh ? '确认方向，开始创作' : 'Confirm & Start'}
              </button>
            </div>
          )}

          {/* Step: 创作方案 */}
          {step === 'plan' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '📋 创作方案' : '📋 Creative Plan'}</h2>

              {!project?.creativePlan ? (
                <div className="text-center py-12">
                  <p className="text-gray-400 mb-4">{isZh ? '基于你的选题配置，AI 将生成完整的故事骨架' : 'AI will generate a complete story skeleton'}</p>
                  <button onClick={handleGeneratePlan} disabled={loading}
                    className="px-6 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {isZh ? '生成创作方案' : 'Generate Plan'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 剧名选择 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">{isZh ? '剧名备选' : 'Title Options'}</h3>
                    <div className="space-y-2">
                      {project.creativePlan.titleOptions.map((t, i) => (
                        <button key={i} onClick={() => handleSelectTitle(t.title)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            project.selectedTitle === t.title ? 'bg-green-600/20 border-green-500/40' : 'bg-[#111] border-white/5 hover:border-white/15'
                          }`}>
                          <span className="text-white font-medium">{t.title}</span>
                          <span className="text-gray-500 text-xs ml-2">{t.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 故事线 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">{isZh ? '故事线' : 'Story Line'}</h3>
                    <p className="text-white text-sm">{project.creativePlan.storyLine}</p>
                    <h3 className="text-sm font-medium text-gray-300 mt-3 mb-2">{isZh ? '核心冲突' : 'Core Conflict'}</h3>
                    <p className="text-white text-sm">{project.creativePlan.coreConflict}</p>
                  </div>

                  {/* 时空背景 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">{isZh ? '时空背景' : 'Setting'}</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-500">{isZh ? '时代：' : 'Era: '}</span><span className="text-white">{project.creativePlan.setting.era}</span></div>
                      <div><span className="text-gray-500">{isZh ? '地点：' : 'Location: '}</span><span className="text-white">{project.creativePlan.setting.location}</span></div>
                      <div><span className="text-gray-500">{isZh ? '社会环境：' : 'Social: '}</span><span className="text-white">{project.creativePlan.setting.socialEnv}</span></div>
                      <div><span className="text-gray-500">{isZh ? '阶层关系：' : 'Class: '}</span><span className="text-white">{project.creativePlan.setting.classRelation}</span></div>
                    </div>
                  </div>

                  {/* 三幕结构 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">{isZh ? '三幕结构' : 'Three Acts'}</h3>
                    {(['act1', 'act2', 'act3'] as const).map((act, i) => {
                      const a = project.creativePlan!.threeActs[act];
                      const labels = [isZh ? '第一幕（建置）' : 'Act 1', isZh ? '第二幕（对抗）' : 'Act 2', isZh ? '第三幕（高潮）' : 'Act 3'];
                      return (
                        <div key={act} className="mb-3 last:mb-0">
                          <div className="text-xs text-green-400 mb-1">{labels[i]} — {a.episodeRange}</div>
                          {'coreEvents' in a && <div className="text-sm text-gray-300">{(a as typeof project.creativePlan.threeActs.act1).coreEvents.join(' → ')}</div>}
                          {'conflicts' in a && <div className="text-sm text-gray-300">{(a as typeof project.creativePlan.threeActs.act2).conflicts.join(' → ')}</div>}
                          {'climax' in a && <div className="text-sm text-gray-300">{(a as typeof project.creativePlan.threeActs.act3).climax}</div>}
                        </div>
                      );
                    })}
                  </div>

                  {/* 付费卡点 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">{isZh ? '💰 付费卡点规划' : '💰 Paywall Plan'}</h3>
                    <div className="space-y-1">
                      {project.creativePlan.paywallPlan.map((p, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-yellow-400">第{p.episode}集</span>
                          <span className="text-gray-500 mx-2">·</span>
                          <span className="text-gray-300">{p.type}</span>
                          <span className="text-gray-500 mx-2">·</span>
                          <span className="text-gray-400">{p.suspense}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 爽点矩阵 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">{isZh ? '⚡ 爽点矩阵' : '⚡ Satisfaction Matrix'}</h3>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(project.creativePlan.satisfactionMatrix).map(([k, v]) => (
                        <div key={k} className="px-3 py-1.5 rounded-lg bg-[#111] border border-white/5 text-sm">
                          <span className="text-gray-300">{k}</span>
                          <span className="text-green-400 ml-1.5">{v}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={() => setStep('characters')} disabled={loading}
                    className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                    {isZh ? '确认方案，进入角色开发 →' : 'Confirm & Next →'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: 角色开发 */}
          {step === 'characters' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '👥 角色开发' : '👥 Characters'}</h2>

              {!project?.characterDesign ? (
                <div className="text-center py-12">
                  <p className="text-gray-400 mb-4">{isZh ? '基于创作方案，AI 将设计完整的角色体系和四层反派' : 'AI will design the character system'}</p>
                  <button onClick={handleGenerateCharacters} disabled={loading}
                    className="px-6 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {isZh ? '生成角色设计' : 'Generate Characters'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 角色卡片 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {project.characterDesign.characters.map(char => (
                      <div key={char.id} className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-white font-medium">{char.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400">{char.age}</span>
                          {char.villainLayer ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                              {isZh ? `第${char.villainLayer}层反派` : `Villain L${char.villainLayer}`}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-500 mb-1">{char.publicIdentity} → {char.realIdentity}</div>
                        <div className="text-sm text-gray-300 mb-2">{char.appearance}</div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {char.personality.map((p, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{p}</span>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500">
                          <span className="text-gray-400">{isZh ? '动机：' : 'Motivation: '}</span>{char.motivation}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          <span className="text-gray-400">{isZh ? '口头禅：' : 'Catchphrase: '}</span>"{char.catchphrase}"
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          <span className="text-gray-400">{isZh ? '弧线：' : 'Arc: '}</span>{char.arc}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 角色关系 */}
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">{isZh ? '角色关系' : 'Relationships'}</h3>
                    <div className="space-y-1">
                      {project.characterDesign.relationships.map((r, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-white">{r.from}</span>
                          <span className="text-green-400 mx-2">→</span>
                          <span className="text-white">{r.to}</span>
                          <span className="text-gray-500 ml-2">{r.relation}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 感情线 */}
                  {project.characterDesign.romanceLine?.length > 0 && (
                    <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                      <h3 className="text-sm font-medium text-gray-300 mb-2">{isZh ? '💕 感情线' : '💕 Romance Line'}</h3>
                      <div className="space-y-1">
                        {project.characterDesign.romanceLine.map((r, i) => (
                          <div key={i} className="text-sm">
                            <span className="text-yellow-400">{isZh ? `第${r.episode}集` : `Ep ${r.episode}`}</span>
                            <span className="text-gray-500 mx-2">·</span>
                            <span className="text-gray-300">{r.event}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={() => setStep('directory')} disabled={loading}
                    className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                    {isZh ? '确认角色，进入分集目录 →' : 'Confirm & Next →'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: 分集目录 */}
          {step === 'directory' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '📑 分集目录' : '📑 Episode Directory'}</h2>

              {!project?.episodeDirectory ? (
                <div className="text-center py-12">
                  <p className="text-gray-400 mb-4">{isZh ? 'AI 将规划全剧分集目录，包含钩子类型和节奏标记' : 'AI will plan the episode directory'}</p>
                  <button onClick={handleGenerateDirectory} disabled={loading}
                    className="px-6 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {isZh ? '生成分集目录' : 'Generate Directory'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 统计 */}
                  <div className="flex gap-3 text-sm">
                    <span className="px-3 py-1 rounded-lg bg-[#1a1a1a] border border-white/10 text-gray-300">
                      {isZh ? '总集数' : 'Total'}: {project.episodeDirectory.length}
                    </span>
                    <span className="px-3 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300">
                      🔥 {project.episodeDirectory.filter(d => d.mark === '🔥').length}
                    </span>
                    <span className="px-3 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                      💰 {project.episodeDirectory.filter(d => d.mark === '💰').length}
                    </span>
                  </div>

                  {/* 目录列表 */}
                  <div className="space-y-1 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {project.episodeDirectory.map(d => (
                      <div key={d.number} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#1a1a1a] border border-white/5 hover:border-white/10 transition-colors">
                        <span className="text-xs text-gray-500 w-10 text-right">{d.number}</span>
                        <span className="w-5 text-center">{d.mark}</span>
                        <span className="text-sm text-white flex-1">{d.title}</span>
                        <span className="text-xs text-gray-400 hidden sm:block max-w-[200px] truncate">{d.summary}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          d.phase === '起势段' ? 'bg-blue-500/10 text-blue-400' :
                          d.phase === '攀升段' ? 'bg-green-500/10 text-green-400' :
                          d.phase === '风暴段' ? 'bg-orange-500/10 text-orange-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>{d.phase}</span>
                        <span className="text-xs text-gray-500 w-16 text-right">{d.hookType}</span>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => { setStep('writing'); setWritingRange({ start: 1, end: Math.min(5, project.config.totalEpisodes) }); }} disabled={loading}
                    className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                    {isZh ? '确认目录，开始撰写分集 →' : 'Confirm & Start Writing →'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: 分集撰写 */}
          {step === 'writing' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '✍️ 分集撰写' : '✍️ Episode Writing'}</h2>

              {/* 撰写控制 */}
              <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                <div className="flex items-center gap-3 mb-3">
                  <label className="text-sm text-gray-400">{isZh ? '撰写范围：第' : 'Range: Ep '}</label>
                  <input type="number" value={writingRange.start} onChange={e => setWritingRange(prev => ({ ...prev, start: Number(e.target.value) }))}
                    className="w-16 px-2 py-1.5 rounded-lg bg-[#111] border border-white/10 text-white text-sm text-center" min={1} max={project?.config.totalEpisodes} />
                  <span className="text-gray-500">—</span>
                  <input type="number" value={writingRange.end} onChange={e => setWritingRange(prev => ({ ...prev, end: Number(e.target.value) }))}
                    className="w-16 px-2 py-1.5 rounded-lg bg-[#111] border border-white/10 text-white text-sm text-center" min={1} max={project?.config.totalEpisodes} />
                  <span className="text-sm text-gray-500">{isZh ? '集' : ''}</span>
                  <button onClick={handleWriteEpisodes} disabled={loading}
                    className="ml-auto px-4 py-2 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {isZh ? '开始撰写' : 'Write'}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  {isZh ? `已完成 ${project?.episodes.length || 0}/${project?.config.totalEpisodes || 0} 集` : `Completed ${project?.episodes.length || 0}/${project?.config.totalEpisodes || 0}`}
                </div>
              </div>

              {/* 已完成的集列表 */}
              {project?.episodes && project.episodes.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-400">{isZh ? '已完成的集' : 'Completed Episodes'}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {project.episodes.map(ep => (
                      <button key={ep.number} onClick={() => setSelectedEpisode(selectedEpisode === ep.number ? null : ep.number)}
                        className={`p-2 rounded-lg text-sm border transition-colors ${
                          selectedEpisode === ep.number ? 'bg-green-600/20 border-green-500/40 text-green-300' : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:border-white/20'
                        }`}>
                        <div className="font-medium">{isZh ? `第${ep.number}集` : `Ep ${ep.number}`}</div>
                        <div className="text-xs text-gray-500 truncate">{ep.title}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 选中集的详情 */}
              {selectedEpisode && project?.episodes.find(e => e.number === selectedEpisode) && (() => {
                const ep = project.episodes.find(e => e.number === selectedEpisode)!;
                return (
                  <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-white">{isZh ? `第${ep.number}集：${ep.title}` : `Ep ${ep.number}: ${ep.title}`}</h3>
                      <span className="text-xs text-gray-500">{ep.phase} · {ep.hookType} {ep.mark}</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      {ep.keywords.map((k, i) => <span key={i} className="px-2 py-0.5 rounded-full bg-white/5 text-gray-400">{k}</span>)}
                    </div>
                    {ep.previousRecap && <p className="text-xs text-gray-500 italic">{isZh ? '前情提要：' : 'Previously: '}{ep.previousRecap}</p>}

                    {ep.scenes.map(scene => (
                      <div key={scene.sceneNumber} className="p-3 rounded-lg bg-[#111] border border-white/5">
                        <div className="text-xs text-green-400 mb-1">{isZh ? `场次${scene.sceneNumber}` : `Scene ${scene.sceneNumber}`} — {scene.location}</div>
                        <div className="text-xs text-gray-500 mb-2">{isZh ? '出场：' : 'Cast: '}{scene.characters.join('、')}</div>
                        <div className="text-sm text-gray-300 whitespace-pre-wrap mb-2">{scene.description}</div>
                        {scene.dialogues.map((d, i) => (
                          <div key={i} className="text-sm mb-1">
                            <span className="text-white font-medium">{d.character}</span>
                            <span className="text-gray-500">（{d.direction}）</span>
                            <span className="text-gray-300">："{d.line}"</span>
                          </div>
                        ))}
                        {scene.musicCue && <div className="text-xs text-purple-400 mt-1">{scene.musicCue}</div>}
                      </div>
                    ))}

                    <div className="text-sm text-yellow-400">🎣 {ep.endHook}</div>
                    <div className="text-sm text-blue-400">📺 {ep.nextPreview}</div>
                  </div>
                );
              })()}

              {project?.episodes && project.episodes.length > 0 && (
                <div className="flex gap-3">
                  <button onClick={() => setStep('review')}
                    className="flex-1 py-3 rounded-xl text-sm font-medium bg-[#1a1a1a] border border-white/10 text-gray-300 hover:bg-[#222] transition-colors">
                    {isZh ? '进入质量自检' : 'Quality Review'}
                  </button>
                  <button onClick={handleExport}
                    className="flex-1 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                    {isZh ? '导出剧本' : 'Export'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: 质量自检 */}
          {step === 'review' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '🔍 质量自检' : '🔍 Quality Review'}</h2>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {project?.episodes.map(ep => {
                  const review = project.reviews[ep.number];
                  return (
                    <div key={ep.number} className="p-3 rounded-xl bg-[#1a1a1a] border border-white/10">
                      <div className="text-sm text-white mb-1">{isZh ? `第${ep.number}集` : `Ep ${ep.number}`}</div>
                      {review ? (
                        <div className={`text-lg font-bold ${review.total >= 45 ? 'text-green-400' : review.total >= 38 ? 'text-yellow-400' : review.total >= 30 ? 'text-orange-400' : 'text-red-400'}`}>
                          {review.total}/50
                        </div>
                      ) : (
                        <button onClick={() => handleReview(ep.number)} disabled={reviewingEp === ep.number}
                          className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50">
                          {reviewingEp === ep.number ? '...' : (isZh ? '自检' : 'Review')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 选中集的审核详情 */}
              {project?.episodes.map(ep => {
                const review = project.reviews[ep.number];
                if (!review) return null;
                return (
                  <div key={ep.number} className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10">
                    <h3 className="text-sm font-medium text-white mb-3">{isZh ? `第${ep.number}集审核报告` : `Ep ${ep.number} Review`}</h3>
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {(['rhythm', 'satisfaction', 'dialogue', 'format', 'continuity'] as const).map(dim => {
                        const labels: Record<string, string> = { rhythm: '节奏', satisfaction: '爽点', dialogue: '台词', format: '格式', continuity: '连贯性' };
                        return (
                          <div key={dim} className="text-center">
                            <div className="text-xs text-gray-500">{isZh ? labels[dim] : dim}</div>
                            <div className={`text-lg font-bold ${review[dim].score >= 8 ? 'text-green-400' : review[dim].score >= 6 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {review[dim].score}
                            </div>
                            <div className="text-xs text-gray-500 truncate" title={review[dim].comment}>{review[dim].comment}</div>
                          </div>
                        );
                      })}
                    </div>
                    {review.issues.length > 0 && (
                      <div className="space-y-1">
                        {review.issues.map((issue, i) => (
                          <div key={i} className="text-xs">
                            <span className={`${issue.severity === '严重' ? 'text-red-400' : issue.severity === '建议' ? 'text-yellow-400' : 'text-gray-400'}`}>
                              【{issue.severity}】
                            </span>
                            <span className="text-gray-300">{issue.description}</span>
                            <span className="text-gray-500"> → {issue.suggestion}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex gap-3">
                <button onClick={() => setStep('writing')}
                  className="flex-1 py-3 rounded-xl text-sm font-medium bg-[#1a1a1a] border border-white/10 text-gray-300 hover:bg-[#222] transition-colors">
                  {isZh ? '← 返回撰写' : '← Back to Writing'}
                </button>
                <button onClick={handleExport} disabled={loading}
                  className="flex-1 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                  {isZh ? '导出剧本' : 'Export'}
                </button>
              </div>
            </div>
          )}

          {/* Step: 导出 */}
          {step === 'export' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-white">{isZh ? '📦 导出完成' : '📦 Export Complete'}</h2>

              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-300 text-sm">
                ✅ {isZh
                  ? `剧本已导出！已完成 ${project?.episodes.length}/${project?.config.totalEpisodes} 集`
                  : `Exported! ${project?.episodes.length}/${project?.config.totalEpisodes} episodes completed`}
              </div>

              <button onClick={handleDownloadExport}
                className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                {isZh ? '下载 Markdown 文件' : 'Download Markdown'}
              </button>

              {/* 预览 */}
              <div className="p-4 rounded-xl bg-[#1a1a1a] border border-white/10 max-h-[500px] overflow-y-auto custom-scrollbar">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{exportContent}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
