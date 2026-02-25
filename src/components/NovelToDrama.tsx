// 小说转短剧 - 多步骤向导组件（LLM 自动调用版 + 批量视频生成 + 草稿箱恢复）
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ArrowRightIcon, BookIcon, CloseIcon, CheckIcon, UserIcon, SparkleIcon } from './Icons';

type Step = 'drafts' | 'setup' | 'novel' | 'analyzing' | 'review' | 'copyright' | 'characters' | 'scripting' | 'ready';

// 后端 status → 前端 Step 映射
const STATUS_TO_STEP: Record<string, Step> = {
  analyzing: 'novel',        // 分析中/待分析 → 回到输入小说步骤
  copyright_check: 'review', // 分析完成待确认 → 确认分析
  copyright: 'review',       // 版权改造中 → 确认分析
  character_confirm: 'characters', // 角色确认
  scripting: 'characters',   // 脚本生成中 → 角色确认
  ready: 'ready',            // 准备就绪
  batch_generating: 'ready', // 批量生成中
  batch_done: 'ready',       // 批量完成
  batch_partial: 'ready',    // 部分完成
};

interface DramaProject {
  id: string;
  status: string;
  novel: {
    title: string;
    summary: string;
    characters: CharacterInfo[];
    locations: LocationInfo[];
    plotPoints: Array<{ chapter: number; summary: string; emotionalTone: string }>;
    themes: string[];
  };
  targetEpisodes: number;
  style: string;
  episodes: EpisodeScript[];
  createdAt: number;
  updatedAt?: number;
}

interface CharacterInfo {
  id: string;
  originalName: string;
  newName: string;
  role: string;
  description: string;
  imageUrls: string[];
  confirmed: boolean;
}

interface LocationInfo {
  id: string;
  originalName: string;
  newName: string;
  description: string;
}

interface EpisodeScript {
  number: number;
  title: string;
  act: string;
  prompt: string;
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
}

interface NovelToDramaProps {
  onClose: () => void;
  sessionId: string;
}

const STEPS: Step[] = ['drafts', 'setup', 'novel', 'analyzing', 'review', 'copyright', 'characters', 'scripting', 'ready'];

// 草稿列表项类型
interface DraftItem {
  id: string;
  title: string;
  status: string;
  style: string;
  targetEpisodes: number;
  createdAt: number;
  updatedAt: number;
}

export default function NovelToDrama({ onClose, sessionId }: NovelToDramaProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('drafts');
  const [project, setProject] = useState<DramaProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [drafts, setDrafts] = useState<DraftItem[]>([]);

  // setup 参数
  const [targetEpisodes, setTargetEpisodes] = useState(20);
  const [style, setStyle] = useState('水墨武侠风格');
  const [ratio, setRatio] = useState('16:9');
  const [episodeDuration, setEpisodeDuration] = useState(15);

  // novel 输入
  const [novelText, setNovelText] = useState('');

  // 批量生成状态
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const stepLabels: Record<Step, string> = {
    drafts: t('drama.steps.drafts'),
    setup: t('drama.steps.setup'),
    novel: t('drama.steps.novel'),
    analyzing: t('drama.steps.analysis'),
    review: t('drama.steps.review'),
    copyright: t('drama.steps.copyright'),
    characters: t('drama.steps.characters'),
    scripting: t('drama.steps.script'),
    ready: t('drama.steps.ready'),
  };

  // 加载草稿列表
  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/drama/list');
      const data = await res.json();
      if (data?.projects) {
        setDrafts(data.projects.map((p: DramaProject) => ({
          id: p.id,
          title: p.novel?.title || t('drama.untitledProject'),
          status: p.status,
          style: p.style,
          targetEpisodes: p.targetEpisodes,
          createdAt: p.createdAt,
          updatedAt: (p as unknown as Record<string, number>).updatedAt || p.createdAt,
        })));
      }
    } catch { /* ignore */ }
  }, [t]);

  // 组件挂载时加载草稿
  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // 恢复草稿项目
  const handleResumeDraft = async (draftId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/drama/${draftId}`);
      const data = await res.json();
      if (data?.project) {
        setProject(data.project);
        // 根据后端 status 映射到前端步骤
        const targetStep = STATUS_TO_STEP[data.project.status] || 'novel';
        setStep(targetStep);
      } else {
        setError(t('drama.draftLoadFailed'));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 删除草稿
  const handleDeleteDraft = async (draftId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/drama/${draftId}`, { method: 'DELETE' });
      setDrafts(prev => prev.filter(d => d.id !== draftId));
    } catch { /* ignore */ }
  };

  // 格式化时间
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // status 中文标签
  const statusLabel = (status: string): string => {
    const map: Record<string, string> = {
      analyzing: t('drama.statusLabels.analyzing'),
      copyright_check: t('drama.statusLabels.copyrightCheck'),
      copyright: t('drama.statusLabels.copyright'),
      character_confirm: t('drama.statusLabels.characterConfirm'),
      scripting: t('drama.statusLabels.scripting'),
      ready: t('drama.statusLabels.ready'),
      batch_generating: t('drama.statusLabels.batchGenerating'),
      batch_done: t('drama.statusLabels.batchDone'),
      batch_partial: t('drama.statusLabels.batchPartial'),
    };
    return map[status] || status;
  };

  // 通用 API 调用
  const apiCall = useCallback(async (url: string, method: string = 'POST', body?: Record<string, unknown>) => {
    setLoading(true);
    setError('');
    try {
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Step 1: 创建项目
  const handleCreateProject = async () => {
    const data = await apiCall('/api/drama/create', 'POST', { targetEpisodes, style, ratio, episodeDuration });
    if (data?.project) {
      setProject(data.project);
      setStep('novel');
    }
  };

  // Step 2: 提交小说 → 后端自动调用 LLM 分析（支持长文本异步）
  const handleSubmitNovel = async () => {
    if (!project || !novelText.trim()) return;
    setStep('analyzing');
    setProgressMsg(t('drama.analyzingNovel'));
    setLoading(true);
    setError('');

    try {
      // 超过 1MB 用 FormData 上传，否则用 JSON
      let data;
      if (novelText.length > 300000) {
        const formData = new FormData();
        const blob = new Blob([novelText], { type: 'text/plain' });
        formData.append('novel', blob, 'novel.txt');
        const res = await fetch(`/api/drama/${project.id}/analyze`, { method: 'POST', body: formData });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
      } else {
        data = await apiCall(`/api/drama/${project.id}/analyze`, 'POST', { novelText });
      }

      if (!data) { setStep('novel'); return; }

      if (data.async) {
        // 长文本异步模式：订阅 WebSocket 等待完成
        setProgressMsg(data.message || t('drama.analyzingLong'));
        const taskId = data.progressTaskId;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
        wsRef.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.taskId !== taskId) return;
            if (msg.type === 'task_progress') {
              setProgressMsg(msg.data.progress || '');
            } else if (msg.type === 'task_done') {
              ws.close();
              const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json());
              if (projData?.project) { setProject(projData.project); setStep('review'); }
              else { setStep('novel'); }
              setLoading(false);
            } else if (msg.type === 'task_error') {
              ws.close();
              setError(msg.data.error || t('drama.analyzeFailed'));
              setStep('novel');
              setLoading(false);
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {
          const poll = setInterval(async () => {
            const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json()).catch(() => null);
            if (projData?.project?.status && projData.project.status !== 'analyzing') {
              clearInterval(poll);
              setProject(projData.project);
              setStep(projData.project.status === 'copyright_check' ? 'review' : 'novel');
              setLoading(false);
            }
          }, 5000);
        };
      } else if (data.project) {
        setProject(data.project);
        setStep('review');
      } else {
        setStep('novel');
      }
    } catch (err) {
      setError((err as Error).message);
      setStep('novel');
    } finally {
      // 异步模式下 loading 由 ws 回调控制，同步模式这里关闭
      if (step !== 'analyzing') setLoading(false);
    }
  };

  // 文件上传处理（支持 .txt 文件，自动检测编码）
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      if (!buffer) return;
      // 先尝试 UTF-8，如果出现替换字符则回退到 GBK
      const utf8Text = new TextDecoder('utf-8').decode(buffer);
      if (utf8Text.includes('\uFFFD')) {
        try {
          const gbkText = new TextDecoder('gbk').decode(buffer);
          setNovelText(gbkText);
        } catch {
          setNovelText(utf8Text); // GBK 解码失败则仍用 UTF-8
        }
      } else {
        setNovelText(utf8Text);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // 允许重复选择同一文件
  };

  // Step 3: 确认分析结果 → 后端自动调用 LLM 版权改造
  const handleStartCopyright = async () => {
    if (!project) return;
    setStep('copyright');
    setProgressMsg(t('drama.copyrightProcessing'));
    const data = await apiCall(`/api/drama/${project.id}/copyright`, 'POST', {});
    if (data?.project) {
      setProject(data.project);
      setStep('characters');
    } else {
      setStep('review'); // 失败回退
    }
  };

  // Step 4: 生成角色图
  const handleGenerateCharImage = async (characterId: string) => {
    if (!project) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/drama/${project.id}/generate-character-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, characterId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // 刷新项目
      const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
      if (projData?.project) setProject(projData.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCharacter = async (characterId: string) => {
    if (!project) return;
    const char = project.novel.characters.find(c => c.id === characterId);
    const data = await apiCall(`/api/drama/${project.id}/confirm-character`, 'POST', {
      characterId, selectedImageUrls: char?.imageUrls,
    });
    if (data) {
      const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
      if (projData?.project) {
        setProject(projData.project);
        if (data.allConfirmed) setStep('scripting');
      }
    }
  };

  // Step 5: 生成分镜脚本 → 后端自动调用 LLM
  const handleGenerateScript = async () => {
    if (!project) return;
    setProgressMsg(t('drama.scriptGenerating'));
    const data = await apiCall(`/api/drama/${project.id}/generate-script`, 'POST', {});
    if (data?.project) {
      setProject(data.project);
      setStep('ready');
    }
  };

  // Step 6: 批量视频生成 - 连接 WebSocket 接收实时进度
  const handleBatchGenerate = async () => {
    if (!project) return;
    setBatchGenerating(true);
    setBatchProgress(t('drama.batchStarting'));
    setError('');

    const data = await apiCall(`/api/drama/${project.id}/batch-generate`, 'POST', { sessionId });
    if (!data?.batchTaskId) {
      setBatchGenerating(false);
      return;
    }

    const taskId = data.batchTaskId;

    // 连接 WebSocket 订阅进度
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;

        if (msg.type === 'task_progress') {
          setBatchProgress(msg.data.progress || '');
          // 定期刷新项目数据以获取每集状态
          refreshProject();
        } else if (msg.type === 'task_done') {
          setBatchProgress(msg.data.progress || t('drama.batchComplete'));
          setBatchGenerating(false);
          refreshProject();
          ws.close();
        } else if (msg.type === 'task_error') {
          setError(msg.data.error || t('drama.batchError'));
          setBatchGenerating(false);
          refreshProject();
          ws.close();
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => {
      // WebSocket 失败时降级为轮询
      setBatchProgress(t('drama.batchPolling'));
      const pollInterval = setInterval(async () => {
        const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
        if (projData?.project) {
          setProject(projData.project);
          const p = projData.project as DramaProject;
          const doneCount = p.episodes.filter((e: EpisodeScript) => e.videoStatus === 'done').length;
          const errCount = p.episodes.filter((e: EpisodeScript) => e.videoStatus === 'error').length;
          if (doneCount + errCount >= p.episodes.length || p.status === 'batch_done' || p.status === 'batch_partial') {
            setBatchGenerating(false);
            clearInterval(pollInterval);
          }
        }
      }, 10000);
    };
  };

  // 刷新项目数据
  const refreshProject = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(`/api/drama/${project.id}`);
      const data = await res.json();
      if (data?.project) setProject(data.project);
    } catch { /* ignore */ }
  }, [project]);

  // 清理 WebSocket
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // 渲染步骤指示器（drafts 步骤不显示）
  const renderStepIndicator = () => {
    if (step === 'drafts') return null;
    const displaySteps = STEPS.filter(s => s !== 'drafts');
    const displayIndex = displaySteps.indexOf(step);
    return (
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-2">
        {displaySteps.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`px-2 py-1 rounded-lg text-xs whitespace-nowrap ${
              i === displayIndex ? 'bg-purple-600 text-white' :
              i < displayIndex ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
            }`}>
              {i + 1}. {stepLabels[s]}
            </div>
            {i < displaySteps.length - 1 && <ArrowRightIcon className="w-3 h-3 text-gray-600 mx-0.5 flex-shrink-0" />}
          </div>
        ))}
      </div>
    );
  };

  // 加载中状态
  const renderLoading = (msg: string) => (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-400">{msg}</p>
      <p className="text-xs text-gray-600">{t('drama.llmWorking')}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 max-w-3xl w-full mx-4 shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookIcon className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg text-gray-200 font-medium">{t('drama.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800">
            <CloseIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {renderStepIndicator()}

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-xs text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">{t('common.close')}</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Step: drafts - 草稿箱 */}
          {step === 'drafts' && (
            <div className="space-y-4">
              {drafts.length > 0 && (
                <>
                  <p className="text-sm text-gray-400">{t('drama.draftsHint')}</p>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {drafts.map(draft => (
                      <div key={draft.id} onClick={() => handleResumeDraft(draft.id)}
                        className="bg-[#161824] rounded-xl p-3 border border-gray-800 hover:border-purple-500/50 cursor-pointer transition-all group">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-200 truncate">{draft.title}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-300 flex-shrink-0">
                                {statusLabel(draft.status)}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span>{draft.style}</span>
                              <span>{draft.targetEpisodes} {t('drama.episodeUnit')}</span>
                              <span>{formatTime(draft.updatedAt || draft.createdAt)}</span>
                            </div>
                          </div>
                          <button onClick={(e) => handleDeleteDraft(draft.id, e)}
                            className="p-1 rounded hover:bg-red-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            title={t('common.delete')}>
                            <CloseIcon className="w-3.5 h-3.5 text-gray-500 hover:text-red-400" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-gray-800 pt-3">
                    <button onClick={() => setStep('setup')}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold transition-all flex items-center justify-center gap-2">
                      <SparkleIcon className="w-4 h-4" />{t('drama.createNew')}
                    </button>
                  </div>
                </>
              )}
              {drafts.length === 0 && !loading && (
                <div className="text-center py-8">
                  <BookIcon className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 mb-4">{t('drama.noDrafts')}</p>
                  <button onClick={() => setStep('setup')}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold transition-all inline-flex items-center gap-2">
                    <SparkleIcon className="w-4 h-4" />{t('drama.createProject')}
                  </button>
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}

          {/* Step: setup */}
          {step === 'setup' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('drama.targetEpisodes')}</label>
                  <input type="number" value={targetEpisodes} onChange={(e) => setTargetEpisodes(Number(e.target.value))} min={2} max={100}
                    className="w-full bg-[#161824] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('drama.episodeDuration')}</label>
                  <input type="number" value={episodeDuration} onChange={(e) => setEpisodeDuration(Number(e.target.value))} min={5} max={60}
                    className="w-full bg-[#161824] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('drama.style')}</label>
                  <select value={style} onChange={(e) => setStyle(e.target.value)}
                    className="w-full bg-[#161824] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500">
                    <option value="水墨武侠风格">水墨武侠</option>
                    <option value="写实电影风格">写实电影</option>
                    <option value="日系动画风格">日系动画</option>
                    <option value="赛博朋克风格">赛博朋克</option>
                    <option value="复古胶片风格">复古胶片</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('drama.ratio')}</label>
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)}
                    className="w-full bg-[#161824] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500">
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="21:9">21:9</option>
                    <option value="4:3">4:3</option>
                  </select>
                </div>
              </div>
              <button onClick={handleCreateProject} disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold transition-all flex items-center justify-center gap-2">
                <SparkleIcon className="w-4 h-4" />{loading ? t('common.loading') : t('drama.createProject')}
              </button>
            </div>
          )}

          {/* Step: novel */}
          {step === 'novel' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-300">{t('drama.pasteNovel')}</label>
                <label className="text-xs px-2 py-1 rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 cursor-pointer transition-colors">
                  {t('drama.uploadFile')}
                  <input type="file" accept=".txt,.md,.text" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
              <textarea
                value={novelText} onChange={(e) => setNovelText(e.target.value)}
                placeholder={t('drama.novelPlaceholder')}
                className="w-full bg-[#161824] border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-purple-500 min-h-[200px] resize-y"
              />
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {novelText.length > 50000
                    ? t('drama.longNovelHint', { chars: (novelText.length / 10000).toFixed(1) })
                    : ''}
                </span>
                <span>{novelText.length.toLocaleString()} {t('drama.chars')}</span>
              </div>
              <button onClick={handleSubmitNovel} disabled={loading || !novelText.trim()}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white font-bold transition-all">
                {loading ? t('common.loading') : t('drama.startAnalysis')}
              </button>
            </div>
          )}

          {/* Step: analyzing (LLM 自动处理中) */}
          {step === 'analyzing' && renderLoading(progressMsg || t('drama.analyzingNovel'))}

          {/* Step: review - 查看分析结果 */}
          {step === 'review' && project && (
            <div className="space-y-3">
              <div className="bg-[#161824] rounded-xl p-3 border border-gray-800">
                <h3 className="text-sm text-purple-400 mb-2">{project.novel.title}</h3>
                <p className="text-xs text-gray-400 mb-3">{project.novel.summary}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-500">{t('drama.charCount')}:</span> <span className="text-gray-300">{project.novel.characters.length}</span></div>
                  <div><span className="text-gray-500">{t('drama.locationCount')}:</span> <span className="text-gray-300">{project.novel.locations.length}</span></div>
                  <div><span className="text-gray-500">{t('drama.plotCount')}:</span> <span className="text-gray-300">{project.novel.plotPoints?.length || 0}</span></div>
                  <div><span className="text-gray-500">{t('drama.themeCount')}:</span> <span className="text-gray-300">{project.novel.themes?.join(', ')}</span></div>
                </div>
              </div>
              {/* 角色列表 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">{t('drama.characters')}</label>
                {project.novel.characters.map(c => (
                  <div key={c.id} className="bg-[#161824] rounded-lg p-2 border border-gray-800 flex items-center gap-2">
                    <UserIcon className="w-3 h-3 text-purple-400 flex-shrink-0" />
                    <span className="text-xs text-gray-200">{c.originalName}</span>
                    <span className="text-xs text-gray-600">({c.role})</span>
                    <span className="text-xs text-gray-500 truncate flex-1">{c.description}</span>
                  </div>
                ))}
              </div>
              <button onClick={handleStartCopyright} disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold transition-all flex items-center justify-center gap-2">
                <ArrowRightIcon className="w-4 h-4" />{loading ? t('common.loading') : t('drama.startCopyright')}
              </button>
            </div>
          )}

          {/* Step: copyright (LLM 自动处理中) */}
          {step === 'copyright' && loading && renderLoading(progressMsg || t('drama.copyrightProcessing'))}

          {/* Step: characters - 显示所有角色，按主次分组 */}
          {step === 'characters' && project && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">{t('drama.confirmCharHint')}</p>
              {/* 主角和配角 - 需要生成角色图并确认 */}
              {project.novel.characters.filter(c => c.role !== 'minor').map((char) => (
                <div key={char.id} className="bg-[#161824] rounded-xl p-3 border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-purple-400" />
                      <span className="text-sm text-gray-200">{char.newName}</span>
                      {char.originalName !== char.newName && (
                        <span className="text-xs text-gray-600">← {char.originalName}</span>
                      )}
                      <span className="text-xs text-gray-500">({char.role})</span>
                    </div>
                    {char.confirmed ? (
                      <span className="text-xs text-green-400 flex items-center gap-1"><CheckIcon className="w-3 h-3" />{t('drama.confirmed')}</span>
                    ) : (
                      <div className="flex gap-2">
                        {char.imageUrls.length === 0 && (
                          <button onClick={() => handleGenerateCharImage(char.id)} disabled={loading}
                            className="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white transition-colors">
                            {t('drama.genImage')}
                          </button>
                        )}
                        {char.imageUrls.length > 0 && (
                          <button onClick={() => handleConfirmCharacter(char.id)} disabled={loading}
                            className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                            {t('common.confirm')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{char.description}</p>
                  {char.imageUrls.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {char.imageUrls.map((url, i) => (
                        <img key={i} src={url} alt={`${char.newName} ${i + 1}`}
                          className="w-20 h-24 object-cover rounded-lg border border-gray-700" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {/* 龙套角色 - 折叠显示，无需生成图片 */}
              {project.novel.characters.filter(c => c.role === 'minor').length > 0 && (
                <details className="bg-[#161824] rounded-xl border border-gray-800">
                  <summary className="px-3 py-2 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
                    {t('drama.minorChars', { count: project.novel.characters.filter(c => c.role === 'minor').length })}
                  </summary>
                  <div className="px-3 pb-2 space-y-1.5">
                    {project.novel.characters.filter(c => c.role === 'minor').map(char => (
                      <div key={char.id} className="flex items-center gap-2 text-xs py-1">
                        <UserIcon className="w-3 h-3 text-gray-600 flex-shrink-0" />
                        <span className="text-gray-400">{char.newName}</span>
                        {char.originalName !== char.newName && (
                          <span className="text-gray-700">← {char.originalName}</span>
                        )}
                        <span className="text-gray-600 truncate flex-1">{char.description}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {project.novel.characters.filter(c => c.role !== 'minor').every(c => c.confirmed) && (
                <button onClick={handleGenerateScript} disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold transition-all flex items-center justify-center gap-2">
                  <ArrowRightIcon className="w-4 h-4" />{loading ? t('common.loading') : t('drama.genScript')}
                </button>
              )}
            </div>
          )}

          {/* Step: scripting (LLM 自动处理中) */}
          {step === 'scripting' && loading && renderLoading(progressMsg || t('drama.scriptGenerating'))}

          {/* Step: ready - 脚本就绪 + 批量视频生成 */}
          {step === 'ready' && project && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="text-3xl mb-2">🎬</div>
                <h3 className="text-lg text-gray-200">{t('drama.readyTitle')}</h3>
                <p className="text-sm text-gray-400">
                  {t('drama.readySummary', { title: project.novel.title, episodes: project.episodes.length })}
                </p>
              </div>

              {/* 批量生成进度 */}
              {batchGenerating && (
                <div className="bg-[#161824] rounded-xl p-3 border border-purple-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-purple-300">{t('drama.batchInProgress')}</span>
                  </div>
                  <p className="text-xs text-gray-400">{batchProgress}</p>
                </div>
              )}

              {/* 每集状态列表 */}
              {project.episodes.length > 0 && (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {project.episodes.map(ep => (
                    <div key={ep.number} className={`bg-[#161824] rounded-lg p-2.5 border text-xs flex items-center gap-2 ${
                      ep.videoStatus === 'done' ? 'border-green-700/50' :
                      ep.videoStatus === 'generating' ? 'border-yellow-700/50' :
                      ep.videoStatus === 'error' ? 'border-red-700/50' : 'border-gray-800'
                    }`}>
                      {/* 状态图标 */}
                      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        {ep.videoStatus === 'done' && <CheckIcon className="w-4 h-4 text-green-400" />}
                        {ep.videoStatus === 'generating' && <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />}
                        {ep.videoStatus === 'error' && <span className="text-red-400">✗</span>}
                        {(!ep.videoStatus || ep.videoStatus === 'pending') && <span className="text-gray-600">○</span>}
                      </div>
                      {/* 集信息 */}
                      <span className="text-purple-400 flex-shrink-0">E{String(ep.number).padStart(2, '0')}</span>
                      <span className="text-gray-300 truncate flex-1">{ep.title}</span>
                      <span className="text-gray-600 flex-shrink-0">[{ep.act}]</span>
                      {/* 视频链接 */}
                      {ep.videoStatus === 'done' && ep.videoUrl && (
                        <a href={`/api/video-proxy?url=${encodeURIComponent(ep.videoUrl)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 flex-shrink-0 underline">
                          {t('drama.watchVideo')}
                        </a>
                      )}
                      {ep.videoStatus === 'error' && ep.videoError && (
                        <span className="text-red-400 truncate max-w-[120px]" title={ep.videoError}>
                          {ep.videoError.substring(0, 20)}...
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 批量生成按钮 */}
              {!batchGenerating && (
                <button onClick={handleBatchGenerate} disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-700 text-white font-bold transition-all flex items-center justify-center gap-2">
                  <SparkleIcon className="w-4 h-4" />
                  {project.episodes.some(e => e.videoStatus === 'done')
                    ? t('drama.batchRetry')
                    : t('drama.batchStart')}
                </button>
              )}

              {/* 完成统计 */}
              {project.episodes.some(e => e.videoStatus === 'done') && !batchGenerating && (
                <div className="text-center text-xs text-gray-500">
                  {t('drama.batchStats', {
                    done: project.episodes.filter(e => e.videoStatus === 'done').length,
                    total: project.episodes.length,
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部导航 */}
        {stepIndex > 0 && step !== 'drafts' && step !== 'ready' && !loading && (
          <div className="mt-4 pt-3 border-t border-gray-800">
            <button onClick={() => {
              const prevSteps: Record<Step, Step> = {
                drafts: 'drafts', setup: 'drafts', novel: 'setup', analyzing: 'novel', review: 'novel',
                copyright: 'review', characters: 'review', scripting: 'characters', ready: 'ready',
              };
              setStep(prevSteps[step]);
            }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors">
              <ArrowLeftIcon className="w-3 h-3" />{t('drama.prevStep')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
