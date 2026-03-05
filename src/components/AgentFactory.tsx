// 创作工厂 - 进化式Agent选择系统 UI
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, UploadIcon, CheckIcon } from './Icons';

interface ProtagonistInfo {
  id: string; name: string; role: string;
  description: string; personality: string; background: string;
  motivation: string; speechStyle: string; relationships: string;
}
interface NovelDNA {
  title: string; genre: string; tone: string;
  narrativeStyle: string; pacing: string; dialogueStyle: string;
  descriptionDensity: string; emotionalCurve: string;
  hookTechniques: string[]; satisfactionPatterns: string[];
  characterVoices: string[]; thematicElements: string[];
  chapterStructure: string; wordCountPerChapter: number;
  openingTechnique: string; cliffhangerStyle: string;
  conflictEscalation: string; uniqueTraits: string[];
  protagonists?: ProtagonistInfo[];
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
interface AgentFactoryProps {
  onClose: () => void;
  onMinimize?: () => void;
  onStatusChange?: (status: { step: string; stepLabel: string; loading: boolean; projectTitle?: string }) => void;
  hidden?: boolean;
  resumeProjectId?: string | null;
}
type Step = 'upload' | 'dna' | 'agents' | 'evolving' | 'result';
const STEPS: Step[] = ['upload', 'dna', 'agents', 'evolving', 'result'];
const STEP_LABELS: Record<Step, { zh: string; en: string }> = {
  upload: { zh: '上传小说', en: 'Upload' }, dna: { zh: 'DNA解析', en: 'DNA' },
  agents: { zh: 'Agent生成', en: 'Agents' }, evolving: { zh: '进化竞赛', en: 'Evolution' },
  result: { zh: '最终结果', en: 'Result' },
};

function useTaskProgress(taskId: string | null, onDone: (signal?: string) => void, reconnectKey?: number) {
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
    let lastRefresh = 0;
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
            // 每隔5秒最多刷新一次项目数据，让 EvolutionDisplay 实时更新
            const now = Date.now();
            if (now - lastRefresh > 5000) {
              lastRefresh = now;
              onDoneRef.current('refresh');
            }
          } else if (status === 'done') { done = true; setLogs(prev => [...prev, '✅ 完成']); onDoneRef.current(); ws.close(); }
          else if (status === 'error') { setError(errorText || '处理失败'); onDoneRef.current(); ws.close(); }
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { /* WebSocket 错误不清除 taskId，等重连 */ };
    ws.onclose = () => { if (!done) { /* 连接断开，刷新项目数据 */ onDoneRef.current('refresh'); } };
    return () => { done = true; ws.close(); };
  }, [taskId, reconnectKey]);
  return { logs, error };
}

function DNADisplay({ dna, chapters, isZh }: { dna: NovelDNA; chapters: ChapterSummary[]; isZh: boolean }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="p-6 rounded-2xl bg-[#111] border border-green-500/20 shadow-[0_0_20px_rgba(34,197,94,0.05)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
            <span className="text-lg">🧬</span>
          </div>
          <h3 className="text-base font-bold text-green-400">{dna.title} — {isZh ? '写作DNA图谱' : 'Writing DNA'}</h3>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          {[
            [isZh ? '题材' : 'Genre', dna.genre], [isZh ? '基调' : 'Tone', dna.tone],
            [isZh ? '叙事' : 'Narrative', dna.narrativeStyle], [isZh ? '节奏' : 'Pacing', dna.pacing],
            [isZh ? '对话' : 'Dialogue', dna.dialogueStyle], [isZh ? '描写' : 'Description', dna.descriptionDensity],
          ].map(([label, val]) => (
            <div key={label} className="p-3 rounded-xl bg-[#0a0a0a] border border-white/5 hover:border-white/10 transition-colors">
              <span className="text-gray-500 block mb-1">{label}</span>
              <span className="text-gray-200 font-medium">{val}</span>
            </div>
          ))}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { title: isZh ? '钩子技巧' : 'Hook Techniques', items: dna.hookTechniques, icon: '🎣' },
          { title: isZh ? '爽点模式' : 'Satisfaction Patterns', items: dna.satisfactionPatterns, icon: '⚡' },
          { title: isZh ? '独特特征' : 'Unique Traits', items: dna.uniqueTraits, icon: '✨' },
        ].map(({ title, items, icon }) => (
          <div key={title} className="p-5 rounded-2xl bg-[#111] border border-white/5 hover:border-white/10 transition-colors">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>{icon}</span> {title}
            </h4>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <span className="text-green-500 mt-0.5">•</span>
                  <span className="leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        
        <div className="p-5 rounded-2xl bg-[#111] border border-white/5 hover:border-white/10 transition-colors">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>📚</span> {isZh ? '章节结构' : 'Chapters'}
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between text-xs border-b border-white/5 pb-2">
              <span className="text-gray-500">{isZh ? '总章节' : 'Total Chapters'}</span>
              <span className="text-white font-mono">{chapters.length}</span>
            </div>
            <div className="flex justify-between text-xs border-b border-white/5 pb-2">
              <span className="text-gray-500">{isZh ? '平均字数/章' : 'Avg Words/Ch'}</span>
              <span className="text-white font-mono">{dna.wordCountPerChapter}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">{isZh ? '总字数 (估)' : 'Total Words'}</span>
              <span className="text-white font-mono">{(chapters.reduce((s, c) => s + c.wordCount, 0) / 10000).toFixed(1)}w</span>
            </div>
          </div>
        </div>
      </div>

      {/* 主角档案 */}
      {dna.protagonists && dna.protagonists.length > 0 && (
        <div className="p-6 rounded-2xl bg-[#111] border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.05)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <span className="text-lg">🎭</span>
            </div>
            <h3 className="text-base font-bold text-amber-400">{isZh ? '主角档案' : 'Protagonists'}</h3>
            <span className="text-xs text-gray-500 ml-auto">{dna.protagonists.length} {isZh ? '位角色' : 'characters'}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dna.protagonists.map((char) => (
              <div key={char.id} className="p-4 rounded-xl bg-[#0a0a0a] border border-white/5 hover:border-amber-500/20 transition-colors space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{char.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${char.role === 'protagonist' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {char.role === 'protagonist' ? (isZh ? '主角' : 'Lead') : (isZh ? '重要配角' : 'Key Supporting')}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">{char.description}</p>
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                  <span className="text-gray-400">性格：</span>{char.personality}
                </p>
                {char.background && (
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                    <span className="text-gray-400">背景：</span>{char.background}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressLog({ logs }: { logs: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);
  return (
    <div className="rounded-2xl bg-[#0a0a0a] border border-white/10 overflow-hidden shadow-xl animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 bg-[#111] border-b border-white/5">
        <span className="text-xs font-bold text-green-400 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
          SYSTEM_LOG
        </span>
        <span className="text-[10px] text-gray-600 font-mono">{logs.length} OPS</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar p-4 space-y-1.5 font-mono bg-black/50">
        {logs.map((log, i) => (
          <div key={i} className="text-[11px] text-gray-400 leading-relaxed flex gap-3 hover:bg-white/5 p-0.5 rounded transition-colors">
            <span className="text-gray-700 select-none w-6 text-right">{String(i + 1).padStart(2, '0')}</span>
            <span className={log.includes('✅') ? 'text-green-400' : log.includes('❌') ? 'text-red-400' : ''}>{log}</span>
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
    <div className="space-y-6 animate-fade-in">
      {/* Status Card */}
      <div className="p-6 rounded-2xl bg-[#111] border border-white/10 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-32 bg-green-500/5 blur-3xl rounded-full pointer-events-none"></div>
        
        <div className="flex items-center justify-between mb-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isEvolving ? 'bg-green-500 animate-pulse' : isPaused ? 'bg-yellow-500' : 'bg-gray-500'}`}></div>
            <div>
              <h3 className="text-sm font-bold text-white">{isZh ? '进化引擎状态' : 'Evolution Engine Status'}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {isEvolving ? (isZh ? '正在进行自然选择与变异...' : 'Natural selection & mutation running...') : 
                 isPaused ? (isZh ? '已暂停' : 'Paused') : (isZh ? '等待指令' : 'Idle')}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-white">{project.currentGeneration}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{isZh ? '当前代数' : 'GENERATION'}</div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="relative z-10">
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span>{isZh ? `阶段 ${project.currentChapter}` : `Stage ${project.currentChapter}`}</span>
            <span>{Math.round((history.length / 10) * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-[#0a0a0a] rounded-full overflow-hidden border border-white/5">
            <div className="h-full bg-gradient-to-r from-green-600 to-emerald-400 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]" 
              style={{ width: `${history.length > 0 ? Math.min((history.length / 10) * 100, 100) : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* History Chart (List) */}
        {history.length > 0 && (
          <div className="p-5 rounded-2xl bg-[#111] border border-white/10 flex flex-col h-[300px]">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '进化历史' : 'Evolution History'}</h4>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
              {history.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#0a0a0a] border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 font-mono w-6">#{r.generation}</span>
                    <span className="text-gray-300">{r.stageName || (isZh ? `阶段${r.stage || r.chapter}` : `Stage${r.stage || r.chapter}`)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-gray-600">AVG</span>
                      <span className="text-gray-400 font-mono">{r.avgScore.toFixed(1)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-gray-600">BEST</span>
                      <span className="text-green-400 font-mono font-bold">{r.bestScore.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Agents */}
        {project.topAgents.length > 0 && (
          <div className="p-5 rounded-2xl bg-[#111] border border-white/10 flex flex-col h-[300px]">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{isZh ? '精英个体 (Top 10)' : 'Elite Agents (Top 10)'}</h4>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
              {project.topAgents.map((a, i) => (
                <div key={a.id} className={`flex items-center justify-between text-xs p-3 rounded-xl border transition-all ${i === 0 ? 'bg-yellow-900/10 border-yellow-500/30' : 'bg-[#0a0a0a] border-white/5'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`font-bold font-mono w-4 text-center ${i === 0 ? 'text-yellow-400 text-sm' : i < 3 ? 'text-gray-300' : 'text-gray-600'}`}>
                      {i === 0 ? '1' : i + 1}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-gray-300 font-mono text-[10px]">{a.id.slice(0, 8)}...</span>
                      <span className="text-[9px] text-gray-600">Gen {a.generation}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500" style={{ width: `${Math.min((a.score || 0), 100)}%` }}></div>
                    </div>
                    <span className="text-green-400 font-mono font-bold w-8 text-right">{a.score ?? '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3 pt-4 border-t border-white/5">
        {isEvolving ? (
          <button onClick={onStop} className="flex-1 py-4 rounded-xl text-sm font-bold bg-yellow-600 hover:bg-yellow-500 text-white transition-all shadow-lg shadow-yellow-900/20 active:scale-[0.98]">
            ⏸ {isZh ? '暂停进化' : 'Pause Evolution'}
          </button>
        ) : (
          <button onClick={onRunFull} disabled={loading} 
            className="flex-1 py-4 rounded-xl text-sm font-bold bg-green-600 hover:bg-green-500 disabled:bg-[#222] disabled:text-gray-500 text-white transition-all shadow-lg shadow-green-900/20 active:scale-[0.98] flex items-center justify-center gap-2">
            {loading ? <span className="animate-pulse">...</span> : isPaused ? (isZh ? '▶ 继续进化' : '▶ Resume') : (isZh ? '🚀 开始进化' : '🚀 Start Evolution')}
          </button>
        )}
      </div>

      {project.status === 'completed' && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center font-medium animate-pulse">
          ✅ {isZh ? '进化完成！请前往"最终结果"查看冠军Agent' : 'Evolution complete! Check results.'}
        </div>
      )}
    </div>
  );
}

export default function AgentFactory({ onClose, onMinimize, onStatusChange, hidden, resumeProjectId }: AgentFactoryProps) {
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
  const [savedAgent, setSavedAgent] = useState<{ id: string; name: string; characterAgents?: Array<{ id: string; name: string; role: string }> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [existingProjects, setExistingProjects] = useState<Array<{ id: string; status: string; title: string; genre: string; chapters: number; agentCount: number; bestScore: number; updatedAt: number }>>([]);

  // 模型选择 & NSFW
  const [availableModels, setAvailableModels] = useState<Array<{ label: string; config: { provider: string; apiKey: string; apiUrl: string; model: string } }>>([]);
  const [selectedModelIdx, setSelectedModelIdx] = useState<number>(-1);
  const [globalNsfwEnabled, setGlobalNsfwEnabled] = useState(false);
  const [projectNsfw, setProjectNsfw] = useState(false);
  // WebSocket 重连 key：从 hidden 恢复时递增，触发 useTaskProgress 重新连接
  const [wsReconnectKey, setWsReconnectKey] = useState(0);

  // 组件挂载时检查未完成项目 & 加载模型列表
  useEffect(() => {
    fetch('/api/factory/list').then(r => r.json()).then(data => {
      if (data?.projects?.length > 0) setExistingProjects(data.projects.filter((p: { status: string }) => p.status !== 'completed'));
    }).catch(() => {});
    // 加载可用模型 & NSFW 状态
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
  }, []);

  // 从后台恢复到前台且在 upload 步骤时，刷新项目列表
  useEffect(() => {
    if (!hidden && step === 'upload' && !project) {
      fetch('/api/factory/list').then(r => r.json()).then(data => {
        if (data?.projects) setExistingProjects(data.projects.filter((p: { status: string }) => p.status !== 'completed'));
      }).catch(() => {});
    }
    // 从后台恢复且有进行中的任务时，重新连接 WebSocket
    if (!hidden && taskId) {
      setWsReconnectKey(k => k + 1);
    }
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // 外部传入 resumeProjectId 时自动恢复对应项目
  useEffect(() => {
    if (resumeProjectId && !hidden && resumeProjectId !== project?.id) {
      resumeProject(resumeProjectId);
    }
  }, [resumeProjectId, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const resumeProject = async (id: string) => {
    // 切换项目时先清除旧任务，触发日志清空
    setTaskId(null);
    setLoading(true); setError('');
    let keepLoading = false;
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
        // 如果项目正在进化中，重新连接 WebSocket 接收进度
        if (p.status === 'evolving') {
          setTaskId(`factory_full_${id}`);
          keepLoading = true; // finally 中不清除 loading
        }
      }
    } catch (err) { setError((err as Error).message); }
    finally { if (!keepLoading) setLoading(false); }
  };

  const refreshProject = useCallback(async () => {
    if (!project?.id) return;
    try {
      const res = await fetch(`/api/factory/${project.id}`);
      const data = await res.json();
      if (data?.project) setProject(data.project);
    } catch { /* ignore */ }
  }, [project?.id]);

  const handleTaskDone = useCallback((signal?: string) => {
    if (signal === 'refresh') {
      // 中间刷新：只拉取最新项目数据，不清除 taskId
      refreshProject();
      return;
    }
    setTaskId(null); setLoading(false); refreshProject();
  }, [refreshProject]);
  const { logs, error: wsError } = useTaskProgress(taskId, handleTaskDone, wsReconnectKey);

  // 通知父组件当前状态（用于后台运行浮动指示器）
  useEffect(() => {
    onStatusChange?.({
      step,
      stepLabel: STEP_LABELS[step]?.zh || step,
      loading: loading || !!taskId,
      projectTitle: project?.novelDNA?.title,
    });
  }, [step, loading, taskId, project?.novelDNA?.title]); // eslint-disable-line react-hooks/exhaustive-deps

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
      body: JSON.stringify({ novelText, concurrency, agentsPerGeneration: agentsPerGen, topK, fixedModel: selectedModelIdx >= 0 ? availableModels[selectedModelIdx]?.config : undefined, nsfw: (globalNsfwEnabled && projectNsfw) || undefined }),
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
        setSavedAgent({ id: data.agentId, name: data.name, characterAgents: data.characterAgents || [] });
      } else {
        setError(data?.error || '保存失败');
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const stepIndex = STEPS.indexOf(step);
  const displayError = error || wsError;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col" style={hidden ? { display: 'none' } : undefined}>
      <header className="h-16 flex items-center justify-between px-8 border-b border-white/5 flex-shrink-0 bg-[#0a0a0a]/95 backdrop-blur z-20">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
            <CloseIcon className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🧬</span>
              {isZh ? '创作工厂' : 'Creative Factory'}
            </h1>
            {project?.novelDNA?.title && <p className="text-xs text-gray-500 font-mono mt-0.5">{project.novelDNA.title}</p>}
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
          {project && step !== 'upload' && (
            <button onClick={() => {
              // 回到项目列表，重新拉取未完成项目
              fetch('/api/factory/list').then(r => r.json()).then(data => {
                if (data?.projects) setExistingProjects(data.projects.filter((p: { status: string }) => p.status !== 'completed'));
              }).catch(() => {});
              setProject(null); setStep('upload'); setTaskId(null); setLoading(false);
              setError(''); setSavedAgent(null); setNovelText('');
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

      <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
        <div className="max-w-5xl mx-auto px-8 py-10 space-y-8">
          {displayError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center gap-3 animate-fade-in">
              <span className="text-xl">⚠️</span>
              {displayError}
            </div>
          )}
          {logs.length > 0 && <ProgressLog logs={logs} />}

          {step === 'upload' && (
            <div className="space-y-8 animate-fade-in">
              {existingProjects.length > 0 && (
                <div className="p-6 rounded-2xl bg-[#161616] border border-amber-500/20 space-y-4 shadow-lg shadow-amber-900/5">
                  <div className="flex items-center gap-2 text-amber-400 font-medium">
                    <span className="text-lg">📂</span>
                    {isZh ? '发现未完成的项目' : 'Unfinished projects found'}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {existingProjects.map(p => {
                      const statusLabels: Record<string, string> = {
                        created: '已创建', parsing: '解析中', parsed: 'DNA已解析',
                        evolving: '进化中', paused: '已暂停', completed: '已完成', error: '出错',
                      };
                      return (
                        <div key={p.id} className="flex items-center justify-between p-4 rounded-xl bg-[#0a0a0a] border border-white/5 hover:border-amber-500/30 transition-all group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-200 font-medium truncate">{p.title}</p>
                            <p className="text-xs text-gray-500 mt-1 font-mono">
                              {isZh ? statusLabels[p.status] || p.status : p.status}
                              {p.genre ? ` · ${p.genre}` : ''}
                              {p.chapters > 0 ? ` · ${p.chapters}章` : ''}
                              {p.agentCount > 0 ? ` · ${p.agentCount} Agents` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => resumeProject(p.id)} disabled={loading}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 text-white transition-colors">
                              {isZh ? '继续' : 'Resume'}
                            </button>
                            <button onClick={async () => {
                              await fetch(`/api/factory/${p.id}`, { method: 'DELETE' });
                              setExistingProjects(prev => prev.filter(x => x.id !== p.id));
                            }} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                              <CloseIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white mb-3">{isZh ? '上传爆款小说' : 'Upload Hit Novel'}</h2>
                <p className="text-gray-500 max-w-lg mx-auto">{isZh ? '创作工厂将解析其写作DNA，通过进化式Agent竞赛找到最能复制该风格的写作Agent。' : 'Upload a hit novel to find the best style-matching writing agent.'}</p>
              </div>

              <div className="bg-[#161616] p-6 rounded-2xl border border-white/5 space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{isZh ? '小说内容' : 'Novel Content'}</label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 font-mono">{novelText.length.toLocaleString()} {isZh ? '字' : 'chars'}</span>
                      <input ref={fileInputRef} type="file" accept=".txt,.text" className="hidden" onChange={handleFileUpload} />
                      <button onClick={() => fileInputRef.current?.click()} 
                        className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 transition-colors px-2 py-1 rounded hover:bg-green-500/10">
                        <UploadIcon className="w-3 h-3" /> {isZh ? '上传文件' : 'Upload'}
                      </button>
                    </div>
                  </div>
                  <textarea value={novelText} onChange={e => setNovelText(e.target.value)} rows={12} 
                    placeholder={isZh ? '粘贴小说全文，或上传txt文件...' : 'Paste or upload .txt...'}
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-green-500/50 transition-all font-mono leading-relaxed" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-white/5">
                  {[
                    { label: isZh ? '并发数' : 'Concurrency', value: concurrency, set: setConcurrency, min: 1, max: 20, desc: 'Parallel tasks' },
                    { label: isZh ? '每代Agent数' : 'Agents/Gen', value: agentsPerGen, set: setAgentsPerGen, min: 10, max: 200, desc: 'Population size' },
                    { label: isZh ? '每轮TopK' : 'Top K', value: topK, set: setTopK, min: 3, max: 30, desc: 'Survivors' },
                  ].map(({ label, value, set, min, max, desc }) => (
                    <div key={label}>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</label>
                      <input type="number" value={value} onChange={e => set(Number(e.target.value))} min={min} max={max}
                        className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-green-500/50 transition-all" />
                      <p className="text-[10px] text-gray-600 mt-1.5">{desc}</p>
                    </div>
                  ))}
                </div>

                {/* 模型选择 */}
                {availableModels.length > 0 && (
                  <div className="pt-4 border-t border-white/5">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{isZh ? '指定模型' : 'Fixed Model'}</label>
                    <select value={selectedModelIdx} onChange={e => setSelectedModelIdx(Number(e.target.value))}
                      className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-green-500/50 transition-all">
                      <option value={-1}>{isZh ? '智能路由 (不同阶段自动选模型)' : 'Smart Routing (auto)'}</option>
                      {availableModels.map((m, i) => (
                        <option key={i} value={i}>{m.label}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-600 mt-1.5">{isZh ? '不选则按生成/评估/优化阶段自动分配' : 'Auto-assign by task type if not set'}</p>
                  </div>
                )}

                {/* 项目级 NSFW 开关 */}
                {globalNsfwEnabled && (
                  <div className="pt-4 border-t border-white/5">
                    <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">NSFW</span>
                          <p className="text-[10px] text-gray-500 mt-1">{isZh ? '开启后生成的 Agent 将具备成人内容创作能力' : 'Agent will generate adult content'}</p>
                        </div>
                        <button onClick={() => setProjectNsfw(!projectNsfw)}
                          className={`relative w-10 h-5 rounded-full transition-colors ${projectNsfw ? 'bg-red-500' : 'bg-white/10'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${projectNsfw ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {projectNsfw && (
                        <p className="text-[10px] text-red-400/80 mt-2">⚠️ {isZh ? '已开启，Agent 将学习成人内容写作风格' : 'Enabled, agent will learn adult writing style'}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button onClick={handleCreate} disabled={loading || novelText.length < 500}
                className="w-full py-4 rounded-xl text-base font-bold bg-green-600 hover:bg-green-500 disabled:bg-[#222] disabled:text-gray-500 text-white transition-all shadow-lg shadow-green-900/20 hover:scale-[1.01] active:scale-[0.99]">
                {loading ? (isZh ? '创建中...' : 'Creating...') : (isZh ? '🚀 创建工厂项目' : '🚀 Create Factory')}
              </button>
            </div>
          )}

          {step === 'dna' && (
            <div className="space-y-8 animate-fade-in">
              {!project?.novelDNA ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <span className="text-5xl">🧬</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{isZh ? '解析写作DNA' : 'Parse Writing DNA'}</h3>
                  <p className="text-gray-500 mb-8 text-center max-w-md">{isZh ? 'AI 将深度分析小说的叙事风格、节奏、爽点模式和独特特征。' : 'AI will analyze narrative style, pacing, and unique traits.'}</p>
                  <button onClick={handleParse} disabled={loading} 
                    className="px-8 py-3.5 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-[#222] text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-105">
                    {loading ? (isZh ? '解析中...' : 'Parsing...') : (isZh ? '开始解析' : 'Start Parsing')}
                  </button>
                </div>
              ) : (
                <>
                  <DNADisplay dna={project.novelDNA} chapters={project.chapters} isZh={isZh} />
                  <div className="flex justify-end pt-4">
                    <button onClick={() => setStep('agents')} 
                      className="px-8 py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02]">
                      {isZh ? '下一步：生成Agent群 →' : 'Next: Generate Agents →'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'agents' && (
            <div className="space-y-8 animate-fade-in">
              {(project?.totalAgents || 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center mb-6">
                    <span className="text-5xl">🤖</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{isZh ? '生成初始种群' : 'Initialize Population'}</h3>
                  <p className="text-gray-500 mb-8 text-center max-w-md">{isZh ? `将基于DNA生成 ${agentsPerGen} 个具有不同参数配置的差异化写作Agent。` : `Generate ${agentsPerGen} diverse agents based on the DNA.`}</p>
                  <button onClick={handleGenerateAgents} disabled={loading} 
                    className="px-8 py-3.5 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-[#222] text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-105">
                    {loading ? (isZh ? '生成中...' : 'Generating...') : (isZh ? '生成Agent群' : 'Generate Agents')}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 bg-[#161616] rounded-3xl border border-white/5">
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
                    <CheckIcon className="w-8 h-8 text-green-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{isZh ? '种群就绪' : 'Population Ready'}</h3>
                  <p className="text-gray-400 mb-8">{isZh ? `已生成 ${project?.totalAgents} 个Agent，准备开始进化竞赛。` : `${project?.totalAgents} agents ready for evolution.`}</p>
                  <button onClick={handleRunFull} disabled={loading} 
                    className="px-10 py-4 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-[#222] text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02] flex items-center gap-2">
                    {loading ? (isZh ? '进化中...' : 'Evolving...') : (isZh ? '🚀 开始完整进化' : '🚀 Start Evolution')}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'evolving' && project && <EvolutionDisplay project={project} isZh={isZh} loading={loading} onRunFull={handleRunFull} onStop={handleStop} />}

          {step === 'result' && project && (
            <div className="space-y-8 animate-fade-in">
              {project.finalAgent && (
                <div className="p-8 rounded-3xl bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.1)] relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-40 bg-green-500/5 blur-3xl rounded-full pointer-events-none"></div>
                  
                  <div className="flex items-center gap-4 mb-8 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/20">
                      <span className="text-3xl">🏆</span>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">{isZh ? '冠军 Agent' : 'Champion Agent'}</h3>
                      <p className="text-green-400 font-mono mt-1">Score: {project.finalAgent.score}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                    <div className="p-4 rounded-xl bg-[#0a0a0a] border border-white/10">
                      <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">ID</span>
                      <span className="text-sm text-gray-300 font-mono">{project.finalAgent.id}</span>
                    </div>
                    <div className="p-4 rounded-xl bg-[#0a0a0a] border border-white/10">
                      <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">{isZh ? '进化代数' : 'Generation'}</span>
                      <span className="text-sm text-gray-300 font-mono">{project.finalAgent.generation}</span>
                    </div>
                    <div className="p-4 rounded-xl bg-[#0a0a0a] border border-white/10">
                      <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">{isZh ? '评分历史' : 'Score History'}</span>
                      <span className="text-xs text-gray-300 font-mono">{project.finalAgent.scoreHistory.join(' → ')}</span>
                    </div>
                  </div>

                  <div className="mt-6 p-5 rounded-xl bg-[#0a0a0a] border border-white/10 relative z-10">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{isZh ? '进化路径' : 'Evolution Path'}</h4>
                    <div className="space-y-2">
                      {project.finalAgent.mutationLog.map((m, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
                          <span className="text-green-500 mt-0.5">⚡</span>
                          <span>{m}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-center pt-4">
                {!savedAgent ? (
                  <button onClick={handleExport} disabled={loading} 
                    className="px-10 py-4 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-[#222] text-white font-bold shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02] flex items-center gap-2">
                    {loading ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '💾 保存到Agent仓库' : '💾 Save to Agent Store')}
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-green-500/10 border border-green-500/20 animate-fade-in w-full max-w-2xl">
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mb-2">
                      <CheckIcon className="w-6 h-6 text-green-400" />
                    </div>
                    <p className="text-lg font-bold text-green-400">{isZh ? '已保存到Agent仓库' : 'Saved to Agent Store'}</p>
                    <p className="text-sm text-gray-400">{savedAgent.name}</p>

                    {/* 角色Agent导出结果 */}
                    {savedAgent.characterAgents && savedAgent.characterAgents.length > 0 && (
                      <div className="w-full mt-4 pt-4 border-t border-green-500/10">
                        <p className="text-xs text-amber-400 font-medium mb-3 flex items-center gap-1.5">
                          <span>🎭</span>
                          {isZh ? `同时导出了 ${savedAgent.characterAgents.length} 位主角Agent` : `${savedAgent.characterAgents.length} character agents exported`}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {savedAgent.characterAgents.map(ca => (
                            <span key={ca.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                              {ca.name}
                              <span className="text-[10px] text-amber-500/60">
                                {ca.role === 'protagonist' ? (isZh ? '主角' : 'Lead') : (isZh ? '配角' : 'Supporting')}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-gray-500 mt-3">{isZh ? '可在「剧本创作」中选择此Agent进行创作' : 'Available in Screenplay Creator'}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
