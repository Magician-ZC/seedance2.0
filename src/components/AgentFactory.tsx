// 创作工厂 - 进化式Agent选择系统 UI
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface NovelDNA {
  title: string; genre: string; tone: string;
  narrativeStyle: string; pacing: string; dialogueStyle: string;
  descriptionDensity: string; emotionalCurve: string;
  hookTechniques: string[]; satisfactionPatterns: string[];
  characterVoices: string[]; thematicElements: string[];
  chapterStructure: string; wordCountPerChapter: number;
  openingTechnique: string; cliffhangerStyle: string;
  conflictEscalation: string; uniqueTraits: string[];
}
interface ChapterSummary { number: number; title: string; wordCount: number; }
interface TopAgent { id: string; generation: number; score?: number; rank?: number; parentId?: string; scoreHistory: number[]; }
interface EvolutionRound { chapter: number; stage?: number; stageName?: string; generation: number; totalAgents: number; topAgents: Array<{ id: string; score: number }>; avgScore: number; bestScore: number; lowestScore?: number; timestamp: number; }
interface FactoryProject {
  id: string; status: string; novelDNA?: NovelDNA; chapters: ChapterSummary[];
  currentChapter: number; currentGeneration: number; totalAgents: number; topAgents: TopAgent[];
  evolutionHistory: EvolutionRound[];
  finalAgent?: { id: string; generation: number; score?: number; scoreHistory: number[]; mutationLog: string[] };
  concurrency: number; agentsPerGeneration: number; topK: number;
  createdAt: number; updatedAt: number; error?: string;
}
interface AgentFactoryProps { onClose: () => void; }
type Step = 'upload' | 'dna' | 'agents' | 'evolving' | 'result';
const STEPS: Step[] = ['upload', 'dna', 'agents', 'evolving', 'result'];
const STEP_LABELS: Record<Step, { zh: string; en: string }> = {
  upload: { zh: '上传小说', en: 'Upload' }, dna: { zh: 'DNA解析', en: 'DNA' },
  agents: { zh: 'Agent生成', en: 'Agents' }, evolving: { zh: '进化竞赛', en: 'Evolution' },
  result: { zh: '最终结果', en: 'Result' },
};

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
    ws.onclose = () => { if (!done) { /* 连接意外断开，也触发刷新 */ onDoneRef.current(); } };
    return () => { done = true; ws.close(); };
  }, [taskId]);
  return { logs, error };
}

function DNADisplay({ dna, chapters, isZh }: { dna: NovelDNA; chapters: ChapterSummary[]; isZh: boolean }) {
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-[#111] border border-white/10">
        <h3 className="text-sm font-medium text-green-400 mb-3">🧬 {dna.title} — {isZh ? '写作DNA' : 'Writing DNA'}</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            [isZh ? '题材' : 'Genre', dna.genre], [isZh ? '基调' : 'Tone', dna.tone],
            [isZh ? '叙事' : 'Narrative', dna.narrativeStyle], [isZh ? '节奏' : 'Pacing', dna.pacing],
            [isZh ? '对话' : 'Dialogue', dna.dialogueStyle], [isZh ? '描写' : 'Description', dna.descriptionDensity],
          ].map(([label, val]) => (
            <div key={label} className="p-2 rounded-lg bg-white/5"><span className="text-gray-500">{label}:</span> <span className="text-gray-300">{val}</span></div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[
          { title: isZh ? '钩子技巧' : 'Hook Techniques', items: dna.hookTechniques },
          { title: isZh ? '爽点模式' : 'Satisfaction Patterns', items: dna.satisfactionPatterns },
          { title: isZh ? '独特特征' : 'Unique Traits', items: dna.uniqueTraits },
        ].map(({ title, items }) => (
          <div key={title} className="p-4 rounded-xl bg-[#111] border border-white/10">
            <h4 className="text-xs text-gray-500 mb-2">{title}</h4>
            {items.map((item, i) => <p key={i} className="text-xs text-gray-400">• {item}</p>)}
          </div>
        ))}
        <div className="p-4 rounded-xl bg-[#111] border border-white/10">
          <h4 className="text-xs text-gray-500 mb-2">{isZh ? '章节信息' : 'Chapters'}</h4>
          <p className="text-xs text-gray-400">{isZh ? '共' : 'Total'} {chapters.length} {isZh ? '章' : 'chapters'}</p>
          <p className="text-xs text-gray-400">{isZh ? '每章约' : 'Avg'} {dna.wordCountPerChapter} {isZh ? '字' : 'chars'}</p>
          <p className="text-xs text-gray-400">{isZh ? '总字数约' : 'Total ~'} {(chapters.reduce((s, c) => s + c.wordCount, 0) / 10000).toFixed(1)}{isZh ? '万字' : '0k'}</p>
        </div>
      </div>
    </div>
  );
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

function EvolutionDisplay({ project, isZh, loading, onRunFull, onStop }: { project: FactoryProject; isZh: boolean; loading: boolean; onRunFull: () => void; onStop: () => void }) {
  const history = project.evolutionHistory;
  const isEvolving = project.status === 'evolving';
  const isPaused = project.status === 'paused';
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-[#111] border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-300">📊 {isZh ? '进化进度' : 'Evolution Progress'}</h3>
            {isPaused && <span className="px-2 py-0.5 rounded-full text-[10px] bg-yellow-500/20 text-yellow-400">{isZh ? '已暂停' : 'Paused'}</span>}
            {isEvolving && <span className="px-2 py-0.5 rounded-full text-[10px] bg-green-500/20 text-green-400 animate-pulse">{isZh ? '进化中' : 'Running'}</span>}
          </div>
          <span className="text-xs text-gray-500">{isZh ? `阶段${project.currentChapter} · 第${project.currentGeneration}代` : `Stage ${project.currentChapter} · Gen ${project.currentGeneration}`}</span>
        </div>
        <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${history.length > 0 ? Math.min((history.length / 10) * 100, 100) : 0}%` }} />
        </div>
      </div>
      {history.length > 0 && (
        <div className="p-4 rounded-xl bg-[#111] border border-white/10">
          <h4 className="text-xs text-gray-500 mb-3">{isZh ? '竞赛历史' : 'History'}</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
            {history.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/5">
                <span className="text-gray-400">{r.stageName || (isZh ? `阶段${r.stage || r.chapter}` : `Stage${r.stage || r.chapter}`)} · {isZh ? `第${r.generation}代` : `Gen${r.generation}`}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{isZh ? '平均' : 'Avg'}: {r.avgScore}</span>
                  <span className="text-green-400 font-medium">{isZh ? '最高' : 'Best'}: {r.bestScore}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {project.topAgents.length > 0 && (
        <div className="p-4 rounded-xl bg-[#111] border border-white/10">
          <h4 className="text-xs text-gray-500 mb-3">{isZh ? '当前Top 10' : 'Top 10'}</h4>
          <div className="space-y-1">
            {project.topAgents.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/5">
                <div className="flex items-center gap-2">
                  <span className={i === 0 ? 'text-yellow-400' : i < 3 ? 'text-gray-300' : 'text-gray-600'}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                  <span className="text-gray-400">{a.id}</span>
                </div>
                <span className="text-green-400 font-medium">{a.score ?? '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {isEvolving && (
        <button onClick={onStop} className="w-full py-3 rounded-xl text-sm font-medium bg-yellow-600 hover:bg-yellow-500 text-white transition-colors">
          ⏸ {isZh ? '暂停进化' : 'Pause'}
        </button>
      )}
      {(isPaused || (project.status !== 'completed' && project.status !== 'evolving')) && (
        <button onClick={onRunFull} disabled={loading} className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
          {loading ? (isZh ? '启动中...' : 'Starting...') : isPaused ? (isZh ? '▶ 继续进化' : '▶ Resume') : (isZh ? '🚀 开始进化' : '🚀 Start')}
        </button>
      )}
      {project.status === 'completed' && (
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center">
          ✅ {isZh ? '进化完成！前往"最终结果"查看' : 'Done! Go to Result tab.'}
        </div>
      )}
    </div>
  );
}

export default function AgentFactory({ onClose }: AgentFactoryProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [step, setStep] = useState<Step>('upload');
  const [project, setProject] = useState<FactoryProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [novelText, setNovelText] = useState('');
  const [concurrency, setConcurrency] = useState(5);
  const [agentsPerGen, setAgentsPerGen] = useState(100);
  const [topK, setTopK] = useState(10);
  const [savedAgent, setSavedAgent] = useState<{ id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [existingProjects, setExistingProjects] = useState<Array<{ id: string; status: string; title: string; genre: string; chapters: number; agentCount: number; bestScore: number; updatedAt: number }>>([]);

  // 组件挂载时检查未完成项目
  useEffect(() => {
    fetch('/api/factory/list').then(r => r.json()).then(data => {
      if (data?.projects?.length > 0) setExistingProjects(data.projects);
    }).catch(() => {});
  }, []);

  const resumeProject = async (id: string) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/factory/${id}`);
      const data = await res.json();
      if (data?.project) {
        setProject(data.project);
        // 根据状态跳转到对应步骤
        const statusStepMap: Record<string, Step> = {
          created: 'dna', parsing: 'dna', parsed: 'dna',
          evolving: 'evolving', paused: 'evolving', error: 'evolving', completed: 'result',
        };
        const p = data.project as FactoryProject;
        let target = statusStepMap[p.status] || 'dna';
        // 如果已有agents但还没开始进化，跳到agents步骤
        if (p.status === 'parsed' && p.totalAgents > 0) target = 'agents';
        setStep(target);
        setExistingProjects([]);
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const refreshProject = useCallback(async () => {
    if (!project?.id) return;
    try {
      const res = await fetch(`/api/factory/${project.id}`);
      const data = await res.json();
      if (data?.project) setProject(data.project);
    } catch { /* ignore */ }
  }, [project?.id]);

  const handleTaskDone = useCallback(() => { setTaskId(null); setLoading(false); refreshProject(); }, [refreshProject]);
  const { logs, error: wsError } = useTaskProgress(taskId, handleTaskDone);

  useEffect(() => {
    if (!project) return;
    const map: Record<string, Step> = { parsed: 'dna', evolving: 'evolving', paused: 'evolving', completed: 'result', error: 'evolving' };
    const target = map[project.status];
    if (target && STEPS.indexOf(target) > STEPS.indexOf(step)) setStep(target);
  }, [project?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      if (!buffer) return;
      // 先尝试 UTF-8，如果出现替换字符则回退到 GBK
      const utf8Text = new TextDecoder('utf-8').decode(buffer);
      if (utf8Text.includes('\uFFFD')) {
        try {
          setNovelText(new TextDecoder('gbk').decode(buffer));
        } catch {
          setNovelText(utf8Text);
        }
      } else {
        setNovelText(utf8Text);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const apiCall = async (url: string, opts?: RequestInit) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(url, opts);
      const data = await res.json();
      if (data?.async && data.taskId) { setTaskId(data.taskId); return data; }
      if (data?.error) { setError(data.error); setLoading(false); }
      return data;
    } catch (err) { setError((err as Error).message); setLoading(false); return null; }
  };

  const handleCreate = async () => {
    if (novelText.trim().length < 500) { setError(isZh ? '小说内容至少500字' : 'Min 500 chars'); return; }
    const data = await apiCall('/api/factory/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelText, concurrency, agentsPerGeneration: agentsPerGen, topK }),
    });
    if (data?.project) {
      setProject({ ...data.project, chapters: [], topAgents: [], evolutionHistory: [], totalAgents: 0 } as FactoryProject);
      setStep('dna'); setLoading(false);
    }
  };

  const handleParse = () => apiCall(`/api/factory/${project?.id}/parse`, { method: 'POST' });
  const handleGenerateAgents = () => apiCall(`/api/factory/${project?.id}/generate-agents`, { method: 'POST' });
  const handleRunFull = () => apiCall(`/api/factory/${project?.id}/run-full`, { method: 'POST' });

  const handleStop = async () => {
    if (!project?.id) return;
    try {
      await fetch(`/api/factory/${project.id}/stop`, { method: 'POST' });
    } catch { /* ignore */ }
  };

  const handleExport = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/factory/${project?.id}/export`, { method: 'POST' });
      const data = await res.json();
      if (data?.success && data.agentId) {
        setSavedAgent({ id: data.agentId, name: data.name });
      } else {
        setError(data?.error || '保存失败');
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const stepIndex = STEPS.indexOf(step);
  const displayError = error || wsError;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col">
      <header className="h-14 flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg">✕</button>
          <h1 className="text-base font-semibold text-white">🧬 {isZh ? '创作工厂' : 'Creative Factory'}</h1>
          {project?.novelDNA?.title && <span className="text-sm text-gray-500">— {project.novelDNA.title}</span>}
        </div>
      </header>
      <div className="flex justify-center px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className={`w-12 h-px ${i <= stepIndex ? 'bg-green-500/50' : 'bg-white/10'}`} />}
              <button onClick={() => i <= stepIndex && setStep(s)}
                className={`px-5 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${s === step ? 'bg-green-600 text-white' : i < stepIndex ? 'bg-white/10 text-gray-300 hover:bg-white/15' : 'bg-white/5 text-gray-600'}`}>
                {isZh ? STEP_LABELS[s].zh : STEP_LABELS[s].en}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {displayError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{displayError}</div>}
          {logs.length > 0 && <ProgressLog logs={logs} />}

          {step === 'upload' && (
            <div className="space-y-4">
              {existingProjects.length > 0 && (
                <div className="p-4 rounded-xl bg-[#111] border border-amber-500/20 space-y-3">
                  <p className="text-sm text-amber-400">📂 {isZh ? '发现未完成的项目' : 'Unfinished projects found'}</p>
                  {existingProjects.map(p => {
                    const statusLabels: Record<string, string> = {
                      created: '已创建', parsing: '解析中', parsed: 'DNA已解析',
                      evolving: '进化中', paused: '已暂停', completed: '已完成', error: '出错',
                    };
                    return (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200 truncate">{p.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {isZh ? statusLabels[p.status] || p.status : p.status}
                            {p.genre ? ` · ${p.genre}` : ''}
                            {p.chapters > 0 ? ` · ${p.chapters}章` : ''}
                            {p.agentCount > 0 ? ` · ${p.agentCount}个Agent` : ''}
                            {p.bestScore > 0 ? ` · 最高${p.bestScore}分` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-3">
                          <button onClick={() => resumeProject(p.id)} disabled={loading}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 text-white transition-colors">
                            {isZh ? '继续' : 'Resume'}
                          </button>
                          <button onClick={async () => {
                            await fetch(`/api/factory/${p.id}`, { method: 'DELETE' });
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
              <p className="text-sm text-gray-400">{isZh ? '上传一篇爆款小说，创作工厂将解析其写作DNA，通过进化式Agent竞赛找到最能复制该风格的写作Agent。' : 'Upload a hit novel to find the best style-matching writing agent.'}</p>
              <div>
                <label className="block text-sm text-gray-300 mb-2">{isZh ? '小说内容' : 'Novel Content'}</label>
                <textarea value={novelText} onChange={e => setNovelText(e.target.value)} rows={12} placeholder={isZh ? '粘贴小说全文，或上传txt文件...' : 'Paste or upload .txt...'}
                  className="w-full bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-green-500/50" />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-600">{novelText.length.toLocaleString()} {isZh ? '字' : 'chars'}</span>
                  <div><input ref={fileInputRef} type="file" accept=".txt,.text" className="hidden" onChange={handleFileUpload} />
                    <button onClick={() => fileInputRef.current?.click()} className="text-xs text-green-500 hover:text-green-400">📁 {isZh ? '上传文件' : 'Upload'}</button></div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: isZh ? '并发数' : 'Concurrency', value: concurrency, set: setConcurrency, min: 1, max: 20 },
                  { label: isZh ? '每代Agent数' : 'Agents/Gen', value: agentsPerGen, set: setAgentsPerGen, min: 10, max: 200 },
                  { label: isZh ? '每轮TopK' : 'Top K', value: topK, set: setTopK, min: 3, max: 30 },
                ].map(({ label, value, set, min, max }) => (
                  <div key={label}><label className="block text-xs text-gray-500 mb-1">{label}</label>
                    <input type="number" value={value} onChange={e => set(Number(e.target.value))} min={min} max={max}
                      className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500/50" /></div>
                ))}
              </div>
              <button onClick={handleCreate} disabled={loading || novelText.length < 500}
                className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors">
                {loading ? (isZh ? '创建中...' : 'Creating...') : (isZh ? '创建工厂项目' : 'Create Factory')}
              </button>
            </div>
          )}

          {step === 'dna' && (
            <div className="space-y-4">
              {!project?.novelDNA ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400 mb-4">{isZh ? '解析小说的写作DNA' : 'Parse novel writing DNA'}</p>
                  <button onClick={handleParse} disabled={loading} className="px-6 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {loading ? (isZh ? '解析中...' : 'Parsing...') : (isZh ? '🧬 开始解析DNA' : '🧬 Parse DNA')}
                  </button>
                </div>
              ) : <DNADisplay dna={project.novelDNA} chapters={project.chapters} isZh={isZh} />}
              {project?.novelDNA && (
                <button onClick={() => setStep('agents')} className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors">
                  {isZh ? '下一步：生成Agent群 →' : 'Next: Generate Agents →'}
                </button>
              )}
            </div>
          )}

          {step === 'agents' && (
            <div className="space-y-4">
              {(project?.totalAgents || 0) === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400 mb-4">{isZh ? `将生成 ${agentsPerGen} 个差异化写作Agent` : `Generate ${agentsPerGen} agents`}</p>
                  <button onClick={handleGenerateAgents} disabled={loading} className="px-6 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {loading ? (isZh ? '生成中...' : 'Generating...') : (isZh ? `🤖 生成 ${agentsPerGen} 个Agent` : `🤖 Generate ${agentsPerGen} Agents`)}
                  </button>
                </div>
              ) : (
                <div>
                  <div className="p-4 rounded-xl bg-[#111] border border-white/10">
                    <p className="text-sm text-gray-300">✅ {isZh ? `已生成 ${project?.totalAgents} 个Agent` : `${project?.totalAgents} agents ready`}</p>
                  </div>
                  <button onClick={handleRunFull} disabled={loading} className="w-full mt-4 py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                    {loading ? (isZh ? '进化中...' : 'Evolving...') : (isZh ? '🚀 开始完整进化' : '🚀 Start Evolution')}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'evolving' && project && <EvolutionDisplay project={project} isZh={isZh} loading={loading} onRunFull={handleRunFull} onStop={handleStop} />}

          {step === 'result' && project && (
            <div className="space-y-4">
              {project.finalAgent && (
                <div className="p-4 rounded-xl bg-[#111] border border-green-500/30 space-y-3">
                  <h3 className="text-sm font-medium text-green-400">🏆 {isZh ? '冠军Agent' : 'Champion'}</h3>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="p-2 rounded-lg bg-white/5"><span className="text-gray-500">ID:</span> <span className="text-gray-300">{project.finalAgent.id}</span></div>
                    <div className="p-2 rounded-lg bg-white/5"><span className="text-gray-500">{isZh ? '代数' : 'Gen'}:</span> <span className="text-gray-300">{project.finalAgent.generation}</span></div>
                    <div className="p-2 rounded-lg bg-white/5"><span className="text-gray-500">{isZh ? '得分' : 'Score'}:</span> <span className="text-green-400 font-medium">{project.finalAgent.score}</span></div>
                  </div>
                  <div><p className="text-xs text-gray-500 mb-1">{isZh ? '评分历史' : 'Scores'}</p><p className="text-xs text-gray-400">{project.finalAgent.scoreHistory.join(' → ')}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">{isZh ? '进化路径' : 'Path'}</p>{project.finalAgent.mutationLog.map((m, i) => <p key={i} className="text-xs text-gray-400">• {m}</p>)}</div>
                </div>
              )}
              {!savedAgent ? (
                <button onClick={handleExport} disabled={loading} className="w-full py-3 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                  {loading ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '💾 保存到Agent仓库' : '💾 Save to Agent Store')}
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 space-y-2">
                  <p className="text-sm text-green-400">✅ {isZh ? '已保存到Agent仓库' : 'Saved to Agent Store'}</p>
                  <p className="text-xs text-gray-400">{savedAgent.name}</p>
                  <p className="text-xs text-gray-500">{isZh ? '可在「剧本创作」中选择此Agent进行创作' : 'Available in Screenplay Creator'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
