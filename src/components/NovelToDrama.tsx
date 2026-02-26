// 小说转短剧 - 多步骤向导组件（LLM 自动调用版 + 批量视频生成 + 草稿箱恢复）
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ArrowRightIcon, BookIcon, CloseIcon, CheckIcon, UserIcon, SparkleIcon } from './Icons';
import { loadSettings } from './SettingsModal';

type Step = 'drafts' | 'setup' | 'novel' | 'analyzing' | 'review' | 'copyright' | 'characters' | 'scripting' | 'ready';

// 后端 status → 前端 Step 映射
const STATUS_TO_STEP: Record<string, Step> = {
  analyzing: 'setup',        // 分析中/待分析 → 回到创建项目步骤
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
  refImageUrl?: string; // 用户上传的参考图
}

interface LocationInfo {
  id: string;
  originalName: string;
  newName: string;
  description: string;
  imageUrl?: string;
}

interface Shot {
  index: number;
  startTime: number;
  endTime: number;
  prompt: string;
  characterRefs: string[];
  locationRefs: string[];
  transition?: string;
  refImageUrls?: string[];
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
}

interface EpisodeScript {
  number: number;
  title: string;
  act: string;
  prompt: string;
  shots: Shot[];
  refImageUrls?: string[];
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
  score?: number;
}

interface NovelToDramaProps {
  onClose: () => void;
  sessionId: string;
  onProjectCreated?: (projectId: string) => void;
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

export default function NovelToDrama({ onClose, sessionId, onProjectCreated }: NovelToDramaProps) {
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
  // 创建项目子步骤: 1=故事剧本, 2=设置
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  // 项目名称
  const [projectName, setProjectName] = useState('');

  // novel 输入
  const [novelText, setNovelText] = useState('');

  // 批量生成状态
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // 角色图生成进度: { [characterId]: { done, total, generating } }
  const [charImageProgress, setCharImageProgress] = useState<Record<string, { done: number; total: number; generating: boolean }>>({});
  const charImageProgressRef = useRef(charImageProgress);
  // 同步 ref
  useEffect(() => { charImageProgressRef.current = charImageProgress; }, [charImageProgress]);
  // 角色图勾选状态: { [characterId]: Set<imageUrl> }
  const [selectedImages, setSelectedImages] = useState<Record<string, Set<string>>>({});
  // 图片预览弹窗
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // WebSocket 连接池（角色图进度）
  const charWsRefs = useRef<Map<string, WebSocket>>(new Map());
  // 场景图生成状态: { [locationId]: generating }
  const [locImageGenerating, setLocImageGenerating] = useState<Record<string, boolean>>({});
  const locImageGeneratingRef = useRef(locImageGenerating);
  useEffect(() => { locImageGeneratingRef.current = locImageGenerating; }, [locImageGenerating]);
  // 脚本编辑状态: { [episodeNumber]: editedPrompt }
  const [editingEpisodes, setEditingEpisodes] = useState<Record<number, string>>({});
  // 创意优化状态
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState('');
  // 单集优化中: { [episodeNumber]: true }
  const [optimizingEp, setOptimizingEp] = useState<Record<number, boolean>>({});
  // 参考图生成状态
  const [generatingRefImages, setGeneratingRefImages] = useState(false);
  const [refImageProgress, setRefImageProgress] = useState('');
  // 批量角色图生成队列状态
  const [batchCharImageRunning, setBatchCharImageRunning] = useState(false);
  const batchCharImageAbort = useRef(false);
  // 角色参考图上传状态: { [characterId]: uploading }
  const [charRefUploading, setCharRefUploading] = useState<Record<string, boolean>>({});
  // 批量场景图生成队列状态
  const [batchLocImageRunning, setBatchLocImageRunning] = useState(false);
  const batchLocImageAbort = useRef(false);

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
        // 如果有 onProjectCreated 回调，直接跳转到工作台
        if (onProjectCreated && data.project.status !== 'analyzing') {
          setLoading(false);
          onProjectCreated(draftId);
          return;
        }
        setProject(data.project);
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

  // Step 1: 创建项目（合并了setup+novel，创建后自动提交小说分析）
  const handleCreateProject = async () => {
    const data = await apiCall('/api/drama/create', 'POST', { targetEpisodes, style, ratio, episodeDuration });
    if (data?.project) {
      const proj = data.project;
      // 如果有小说文本，先提交分析请求（不等待完成）
      if (novelText.trim()) {
        try {
          if (novelText.length > 300000) {
            const formData = new FormData();
            const blob = new Blob([novelText], { type: 'text/plain' });
            formData.append('novel', blob, 'novel.txt');
            fetch(`/api/drama/${proj.id}/analyze`, { method: 'POST', body: formData }).catch(() => {});
          } else {
            fetch(`/api/drama/${proj.id}/analyze`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ novelText }),
            }).catch(() => {});
          }
        } catch { /* 分析请求已发出，工作台会处理进度 */ }
      }
      // 立即进入工作台
      if (onProjectCreated) {
        setLoading(false);
        onProjectCreated(proj.id);
      }
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

  // Step 4: 生成角色图（异步+WebSocket进度）
  const handleGenerateCharImage = async (characterId: string) => {
    if (!project) return;

    // 检查并发限制
    const { maxConcurrentChars } = loadSettings();
    const currentGenerating = Object.values(charImageProgress).filter(p => p.generating).length;
    if (currentGenerating >= maxConcurrentChars) {
      setError(t('drama.maxConcurrentCharsHint') + ` (${maxConcurrentChars})`);
      return;
    }

    const taskId = `charimg_${project.id}_${characterId}`;

    // 标记为生成中
    setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: true } }));

    // 连接 WebSocket 订阅进度
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    charWsRefs.current.set(characterId, ws);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;
        const progressData = msg.data?.progress ? JSON.parse(msg.data.progress) : {};

        if (msg.type === 'task_progress') {
          setCharImageProgress(prev => ({
            ...prev, [characterId]: { done: progressData.done || 0, total: progressData.total || 3, generating: true },
          }));
        } else if (msg.type === 'task_done') {
          setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 3, total: 3, generating: false } }));
          ws.close();
          charWsRefs.current.delete(characterId);
          // 刷新项目获取最新图片
          const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
          if (projData?.project) setProject(projData.project);
        } else if (msg.type === 'task_error') {
          setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: false } }));
          setError(msg.data?.error || t('drama.genImageFailed'));
          ws.close();
          charWsRefs.current.delete(characterId);
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      // WebSocket 失败时降级为轮询
      setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: true } }));
      const poll = setInterval(async () => {
        const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json()).catch(() => null);
        if (projData?.project) {
          const char = projData.project.novel.characters.find((c: CharacterInfo) => c.id === characterId);
          if (char && char.imageUrls.length > 0) {
            clearInterval(poll);
            setProject(projData.project);
            setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 3, total: 3, generating: false } }));
          }
        }
      }, 5000);
    };

    // 发起生图请求
    try {
      await fetch(`/api/drama/${project.id}/generate-character-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, characterId }),
      });
    } catch (err) {
      setError((err as Error).message);
      setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: false } }));
    }
  };

  // 一键批量生成所有未确认角色图（队列处理，并发数=maxConcurrentChars）
  const handleBatchCharImages = async () => {
    if (!project || batchCharImageRunning) return;
    batchCharImageAbort.current = false;
    setBatchCharImageRunning(true);

    const { maxConcurrentChars } = loadSettings();
    // 收集所有需要生图的角色（未确认且非龙套）
    const pendingChars = project.novel.characters.filter(c => c.role !== 'minor' && !c.confirmed);
    if (pendingChars.length === 0) { setBatchCharImageRunning(false); return; }

    const queue = [...pendingChars.map(c => c.id)];
    const active = new Set<string>();

    const startOne = (charId: string) => {
      active.add(charId);
      handleGenerateCharImage(charId);
    };

    // 启动初始批次
    const initialBatch = queue.splice(0, maxConcurrentChars);
    for (const charId of initialBatch) startOne(charId);

    // 监听进度变化，完成一个补一个
    const checkInterval = setInterval(() => {
      if (batchCharImageAbort.current) {
        clearInterval(checkInterval);
        setBatchCharImageRunning(false);
        return;
      }
      // 检查哪些已完成（不再 generating）
      const currentProgress = charImageProgressRef.current;
      for (const charId of active) {
        const p = currentProgress[charId];
        if (p && !p.generating) {
          active.delete(charId);
          // 补充下一个
          if (queue.length > 0) {
            const next = queue.shift()!;
            startOne(next);
          }
        }
      }
      // 全部完成
      if (active.size === 0 && queue.length === 0) {
        clearInterval(checkInterval);
        setBatchCharImageRunning(false);
      }
    }, 1000);
  };

  // 上传角色参考图
  const handleUploadCharRefImage = async (characterId: string, file: File) => {
    if (!project) return;
    setCharRefUploading(prev => ({ ...prev, [characterId]: true }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('characterId', characterId);
      const res = await fetch(`/api/drama/${project.id}/upload-char-ref-image`, {
        method: 'POST', body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      // 刷新项目数据
      const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json());
      if (projData?.project) setProject(projData.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCharRefUploading(prev => ({ ...prev, [characterId]: false }));
    }
  };

  // 删除角色参考图
  const handleRemoveCharRefImage = async (characterId: string) => {
    if (!project) return;
    try {
      await fetch(`/api/drama/${project.id}/remove-char-ref-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json());
      if (projData?.project) setProject(projData.project);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // 生成场景图
  const handleGenerateLocImage = async (locationId: string) => {
    if (!project) return;
    setLocImageGenerating(prev => ({ ...prev, [locationId]: true }));

    const taskId = `locimg_${project.id}_${locationId}`;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    charWsRefs.current.set(`loc_${locationId}`, ws);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;
        if (msg.type === 'task_done') {
          ws.close();
          charWsRefs.current.delete(`loc_${locationId}`);
          setLocImageGenerating(prev => ({ ...prev, [locationId]: false }));
          const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
          if (projData?.project) setProject(projData.project);
        } else if (msg.type === 'task_error') {
          ws.close();
          charWsRefs.current.delete(`loc_${locationId}`);
          setLocImageGenerating(prev => ({ ...prev, [locationId]: false }));
          setError(msg.data?.error || t('drama.genImageFailed'));
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      setLocImageGenerating(prev => ({ ...prev, [locationId]: false }));
    };

    try {
      await fetch(`/api/drama/${project.id}/generate-location-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, locationId }),
      });
    } catch (err) {
      setError((err as Error).message);
      setLocImageGenerating(prev => ({ ...prev, [locationId]: false }));
    }
  };

  // 一键批量生成所有场景图（队列处理，并发数=maxConcurrentChars）
  const handleBatchLocImages = async () => {
    if (!project || batchLocImageRunning) return;
    batchLocImageAbort.current = false;
    setBatchLocImageRunning(true);

    const { maxConcurrentChars } = loadSettings();
    // 收集所有没有图片的场景
    const pendingLocs = project.novel.locations.filter(l => !l.imageUrl);
    if (pendingLocs.length === 0) { setBatchLocImageRunning(false); return; }

    const queue = [...pendingLocs.map(l => l.id)];
    const active = new Set<string>();

    const startOne = (locId: string) => {
      active.add(locId);
      handleGenerateLocImage(locId);
    };

    const initialBatch = queue.splice(0, maxConcurrentChars);
    for (const locId of initialBatch) startOne(locId);

    const checkInterval = setInterval(() => {
      if (batchLocImageAbort.current) {
        clearInterval(checkInterval);
        setBatchLocImageRunning(false);
        return;
      }
      const current = locImageGeneratingRef.current;
      for (const locId of active) {
        if (!current[locId]) {
          active.delete(locId);
          if (queue.length > 0) startOne(queue.shift()!);
        }
      }
      if (active.size === 0 && queue.length === 0) {
        clearInterval(checkInterval);
        setBatchLocImageRunning(false);
      }
    }, 1000);
  };

  // 切换图片勾选
  const toggleImageSelection = (characterId: string, imageUrl: string) => {
    setSelectedImages(prev => {
      const current = new Set(prev[characterId] || []);
      if (current.has(imageUrl)) current.delete(imageUrl);
      else current.add(imageUrl);
      return { ...prev, [characterId]: current };
    });
  };

  const handleConfirmCharacter = async (characterId: string) => {
    if (!project) return;
    const selected = selectedImages[characterId];
    const char = project.novel.characters.find(c => c.id === characterId);
    // 如果有勾选则用勾选的，否则用全部
    const urls = selected && selected.size > 0 ? Array.from(selected) : char?.imageUrls || [];
    const data = await apiCall(`/api/drama/${project.id}/confirm-character`, 'POST', {
      characterId, selectedImageUrls: urls,
    });
    if (data) {
      const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
      if (projData?.project) {
        setProject(projData.project);
        // 不自动跳步骤，让用户在 characters 步骤手动点击"生成脚本"
      }
    }
  };

  // Step 5: 生成分镜脚本 → 异步+WebSocket进度
  const handleGenerateScript = async () => {
    if (!project) return;
    setStep('scripting');
    setLoading(true);
    setProgressMsg(t('drama.scriptGenerating'));
    setError('');

    try {
      const res = await fetch(`/api/drama/${project.id}/generate-script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setStep('characters'); setLoading(false); return; }

      if (data.async && data.taskId) {
        // 订阅 WebSocket 进度
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
        wsRef.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId: data.taskId }));
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.taskId !== data.taskId) return;
            if (msg.type === 'task_progress') {
              setProgressMsg(msg.data?.progress || t('drama.scriptGenerating'));
            } else if (msg.type === 'task_done') {
              ws.close();
              const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json());
              if (projData?.project) { setProject(projData.project); setStep('ready'); }
              setLoading(false);
            } else if (msg.type === 'task_error') {
              ws.close();
              setError(msg.data?.error || t('drama.scriptFailed'));
              setStep('characters');
              setLoading(false);
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {
          // 降级轮询
          const poll = setInterval(async () => {
            const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json()).catch(() => null);
            if (projData?.project?.status === 'ready') {
              clearInterval(poll);
              setProject(projData.project);
              setStep('ready');
              setLoading(false);
            }
          }, 5000);
        };
      } else if (data.project) {
        setProject(data.project);
        setStep('ready');
        setLoading(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setStep('characters');
      setLoading(false);
    }
  };

  // Step 5.5: 创意优化脚本（异步+WebSocket进度）
  const handleOptimizeScripts = async () => {
    if (!project) return;
    setOptimizing(true);
    setOptimizeProgress(t('drama.optimizeStarting'));
    setError('');

    try {
      const res = await fetch(`/api/drama/${project.id}/optimize-scripts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setOptimizing(false); return; }

      if (data.async && data.taskId) {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
        wsRef.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId: data.taskId }));
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.taskId !== data.taskId) return;
            if (msg.type === 'task_progress') {
              setOptimizeProgress(msg.data?.progress || '');
            } else if (msg.type === 'task_done') {
              ws.close();
              const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json());
              if (projData?.project) setProject(projData.project);
              setOptimizing(false);
              setOptimizeProgress('');
            } else if (msg.type === 'task_error') {
              ws.close();
              setError(msg.data?.error || t('drama.optimizeFailed'));
              setOptimizing(false);
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {
          setOptimizing(false);
          setError(t('drama.optimizeFailed'));
        };
      }
    } catch (err) {
      setError((err as Error).message);
      setOptimizing(false);
    }
  };

  // 单集创意优化
  const handleOptimizeSingle = async (episodeNumber: number) => {
    if (!project) return;
    setOptimizingEp(prev => ({ ...prev, [episodeNumber]: true }));
    setError('');
    try {
      const res = await fetch(`/api/drama/${project.id}/optimize-single`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '优化失败');
      if (data.project) setProject(data.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOptimizingEp(prev => ({ ...prev, [episodeNumber]: false }));
    }
  };

  // 单集参考图重新生成
  const [regenRefEp, setRegenRefEp] = useState<Record<number, boolean>>({});

  // 单集分镜重新生成
  const [regenShotsEp, setRegenShotsEp] = useState<Record<number, boolean>>({});
  const handleRegenShots = async (episodeNumber: number) => {
    if (!project) return;
    setRegenShotsEp(prev => ({ ...prev, [episodeNumber]: true }));
    setError('');
    try {
      const data = await apiCall(`/api/drama/${project.id}/regenerate-shots`, 'POST', { episodeNumber });
      if (data?.project) setProject(data.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenShotsEp(prev => ({ ...prev, [episodeNumber]: false }));
    }
  };
  const handleRegenEpRefImages = async (episodeNumber: number) => {
    if (!project) return;
    setRegenRefEp(prev => ({ ...prev, [episodeNumber]: true }));
    setError('');
    try {
      const res = await fetch(`/api/drama/${project.id}/regenerate-ep-ref-images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '参考图生成失败');
      if (data.project) setProject(data.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenRefEp(prev => ({ ...prev, [episodeNumber]: false }));
    }
  };

  // Step 5.6: 为每集生成专属参考图（异步+WebSocket进度）
  const handleGenerateRefImages = async () => {
    if (!project) return;
    setGeneratingRefImages(true);
    setRefImageProgress(t('drama.refImageStarting'));
    setError('');

    try {
      const res = await fetch(`/api/drama/${project.id}/generate-ref-images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setGeneratingRefImages(false); return; }

      if (data.async && data.taskId) {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
        wsRef.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId: data.taskId }));
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.taskId !== data.taskId) return;
            if (msg.type === 'task_progress') {
              setRefImageProgress(msg.data?.progress || '');
            } else if (msg.type === 'task_done') {
              ws.close();
              const projData = await fetch(`/api/drama/${project.id}`).then(r => r.json());
              if (projData?.project) setProject(projData.project);
              setGeneratingRefImages(false);
              setRefImageProgress('');
            } else if (msg.type === 'task_error') {
              ws.close();
              setError(msg.data?.error || t('drama.refImageFailed'));
              setGeneratingRefImages(false);
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {
          setGeneratingRefImages(false);
          setError(t('drama.refImageFailed'));
        };
      }
    } catch (err) {
      setError((err as Error).message);
      setGeneratingRefImages(false);
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
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      for (const ws of charWsRefs.current.values()) ws.close();
      charWsRefs.current.clear();
    };
  }, []);

  // 渲染步骤指示器（drafts 步骤不显示）
  // 步骤指示器容器 ref（用于滚轮横向滚动）
  const stepBarRef = useRef<HTMLDivElement>(null);

  const renderStepIndicator = () => {
    if (step === 'drafts') return null;
    const displaySteps = STEPS.filter(s => s !== 'drafts');
    const displayIndex = displaySteps.indexOf(step);
    return (
      <div ref={stepBarRef} className="flex items-center gap-1 mb-4 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        onWheel={e => {
          // 鼠标滚轮转为横向滚动
          if (stepBarRef.current && e.deltaY !== 0) {
            e.preventDefault();
            stepBarRef.current.scrollLeft += e.deltaY;
          }
        }}>
        {displaySteps.map((s, i) => (
          <div key={s} className="flex items-center"
            ref={el => { if (i === displayIndex && el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }}>
            <div className={`px-2 py-1 rounded-lg text-xs whitespace-nowrap ${
              i === displayIndex ? 'bg-green-600 text-white' :
              i < displayIndex ? 'bg-green-900/50 text-green-400' : 'bg-[#2a2a2a] text-gray-500'
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
      <div className="w-10 h-10 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-400">{msg}</p>
      <p className="text-xs text-gray-600">{t('drama.llmWorking')}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 max-w-3xl w-full mx-4 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookIcon className="w-5 h-5 text-green-400" />
            <h2 className="text-lg text-white font-semibold">
              {step === 'drafts' || step === 'setup' ? (t('drama.title')) : t('drama.title')}
            </h2>
          </div>
          {/* 创建项目时显示步骤指示器 */}
          {step === 'setup' && (
            <div className="flex items-center bg-[#2a2a2a] rounded-full px-1 py-1">
              <button onClick={() => setCreateStep(1)}
                className={`px-4 py-1.5 rounded-full text-sm transition-colors ${createStep === 1 ? 'bg-[#3a3a3a] text-white' : 'text-gray-500'}`}>
                1. {t('drama.steps.novel')}
              </button>
              <button onClick={() => novelText.trim() ? setCreateStep(2) : undefined}
                className={`px-4 py-1.5 rounded-full text-sm transition-colors ${createStep === 2 ? 'bg-[#3a3a3a] text-white' : 'text-gray-500'}`}>
                2. {t('drama.steps.setup')}
              </button>
            </div>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <CloseIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {step !== 'drafts' && step !== 'setup' && renderStepIndicator()}

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-xs text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">{t('common.close')}</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
          {step === 'drafts' && (
            <div className="space-y-4">
              {drafts.length > 0 && (
                <>
                  <p className="text-sm text-gray-400">{t('drama.draftsHint')}</p>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {drafts.map(draft => (
                      <div key={draft.id} onClick={() => handleResumeDraft(draft.id)}
                        className="bg-[#111] rounded-xl p-3 border border-white/5 hover:border-green-500/30 cursor-pointer transition-all group">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-200 truncate">{draft.title}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-600/20 text-green-400 flex-shrink-0">
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
                  <div className="border-t border-white/5 pt-3">
                    <button onClick={() => { setCreateStep(1); setStep('setup'); }}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-medium transition-all flex items-center justify-center gap-2">
                      <SparkleIcon className="w-4 h-4" />{t('drama.createNew')}
                    </button>
                  </div>
                </>
              )}
              {drafts.length === 0 && !loading && (
                <div className="text-center py-8">
                  <BookIcon className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 mb-4">{t('drama.noDrafts')}</p>
                  <button onClick={() => { setCreateStep(1); setStep('setup'); }}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-medium transition-all inline-flex items-center gap-2">
                    <SparkleIcon className="w-4 h-4" />{t('drama.createProject')}
                  </button>
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}

          {/* Step: setup — MkAnime 风格两步创建 */}
          {step === 'setup' && createStep === 1 && (
            <div className="space-y-5">
              {/* 项目名称 */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">{t('drama.steps.setup')}</label>
                <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
                  placeholder={t('drama.untitledProject')}
                  className="w-full bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50/50 transition-colors" />
              </div>
              {/* 故事描述 / 小说输入 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-white">{t('drama.pasteNovel')}</label>
                  <label className="text-xs px-3 py-1 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 cursor-pointer transition-colors">
                    {t('drama.uploadFile')}
                    <input type="file" accept=".txt,.md,.text" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <textarea
                  value={novelText} onChange={(e) => setNovelText(e.target.value)}
                  placeholder={t('drama.novelPlaceholder')}
                  className="w-full bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50/50 transition-colors resize-none min-h-[200px]"
                />
                <div className="flex items-center justify-between text-xs text-gray-600 mt-1">
                  <span>
                    {novelText.length > 50000
                      ? t('drama.longNovelHint', { chars: (novelText.length / 10000).toFixed(1) })
                      : ''}
                  </span>
                  <span>{novelText.length.toLocaleString()} {t('drama.chars')}</span>
                </div>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={() => setStep('drafts')}
                  className="px-5 py-2.5 rounded-xl text-sm text-gray-400 bg-[#2a2a2a] hover:bg-[#333] transition-colors">
                  {t('common.cancel')}
                </button>
                <button onClick={() => setCreateStep(2)} disabled={!novelText.trim()}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 transition-all flex items-center gap-2">
                  {t('drama.nextStep')} →
                </button>
              </div>
            </div>
          )}

          {step === 'setup' && createStep === 2 && (
            <div className="space-y-6">
              {/* 视频设置 */}
              <div className="flex items-center gap-2 text-white">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <span className="font-medium">{t('generate.title')}</span>
              </div>

              {/* 视频比例 */}
              <div className="flex items-start gap-6">
                <span className="text-sm text-gray-400 w-24 flex-shrink-0 pt-2">{t('drama.ratio')}</span>
                <div className="flex gap-2">
                  {['16:9', '9:16', '21:9', '4:3'].map(r => (
                    <button key={r} onClick={() => setRatio(r)}
                      className={`px-4 py-2 rounded-xl text-sm transition-all ${ratio === r ? 'bg-[#2a2a2a] text-white border border-white/20' : 'bg-[#111] text-gray-500 border border-white/5 hover:border-white/10'}`}>
                      {r === '16:9' ? '▭ ' : r === '9:16' ? '▯ ' : ''}{r}
                    </button>
                  ))}
                </div>
              </div>

              {/* 视觉风格 */}
              <div className="flex items-start gap-6">
                <span className="text-sm text-gray-400 w-24 flex-shrink-0 pt-2">{t('drama.style')}</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '水墨武侠风格', label: '水墨武侠' },
                    { value: '写实电影风格', label: '写实电影' },
                    { value: '日系动画风格', label: '日系动画' },
                    { value: '赛博朋克风格', label: '赛博朋克' },
                    { value: '复古胶片风格', label: '复古胶片' },
                  ].map(s => (
                    <button key={s.value} onClick={() => setStyle(s.value)}
                      className={`px-4 py-2 rounded-xl text-sm transition-all ${style === s.value ? 'bg-[#2a2a2a] text-white border border-white/20' : 'bg-[#111] text-gray-500 border border-white/5 hover:border-white/10'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 剧集数 */}
              <div className="flex items-start gap-6">
                <span className="text-sm text-gray-400 w-24 flex-shrink-0 pt-2">{t('drama.targetEpisodes')}</span>
                <input type="number" value={targetEpisodes} onChange={(e) => setTargetEpisodes(Number(e.target.value))} min={2} max={100}
                  className="w-24 bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50/50" />
              </div>

              {/* 单集时长 */}
              <div className="flex items-start gap-6">
                <span className="text-sm text-gray-400 w-24 flex-shrink-0 pt-2">{t('drama.episodeDuration')}</span>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15, 30, 60].map(d => (
                    <button key={d} onClick={() => setEpisodeDuration(d)}
                      className={`px-4 py-2 rounded-xl text-sm transition-all ${episodeDuration === d ? 'bg-[#2a2a2a] text-white border border-white/20' : 'bg-[#111] text-gray-500 border border-white/5 hover:border-white/10'}`}>
                      {d} S
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={() => setStep('drafts')}
                  className="px-5 py-2.5 rounded-xl text-sm text-gray-400 bg-[#2a2a2a] hover:bg-[#333] transition-colors">
                  {t('common.cancel')}
                </button>
                <button onClick={() => setCreateStep(1)}
                  className="px-5 py-2.5 rounded-xl text-sm text-gray-300 bg-[#2a2a2a] hover:bg-[#333] transition-colors flex items-center gap-1">
                  ← {t('drama.prevStep')}
                </button>
                <button onClick={handleCreateProject} disabled={loading || !novelText.trim()}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 transition-all flex items-center gap-2">
                  {loading ? t('common.loading') : t('drama.createProject')} →
                </button>
              </div>
            </div>
          )}

          {/* Step: analyzing (LLM 自动处理中) */}
          {step === 'analyzing' && renderLoading(progressMsg || t('drama.analyzingNovel'))}

          {/* Step: review - 查看分析结果 */}
          {step === 'review' && project && (
            <div className="space-y-3">
              <div className="bg-[#111] rounded-xl p-3 border border-white/5">
                <h3 className="text-sm text-green-400 mb-2">{project.novel.title}</h3>
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
                  <div key={c.id} className="bg-[#111] rounded-lg p-2 border border-white/5 flex items-center gap-2">
                    <UserIcon className="w-3 h-3 text-green-400 flex-shrink-0" />
                    <span className="text-xs text-gray-200">{c.originalName}</span>
                    <span className="text-xs text-gray-600">({c.role})</span>
                    <span className="text-xs text-gray-500 truncate flex-1">{c.description}</span>
                  </div>
                ))}
              </div>
              <button onClick={handleStartCopyright} disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold transition-all flex items-center justify-center gap-2">
                <ArrowRightIcon className="w-4 h-4" />{loading ? t('common.loading') : t('drama.startCopyright')}
              </button>
            </div>
          )}

          {/* Step: copyright (LLM 自动处理中) */}
          {step === 'copyright' && loading && renderLoading(progressMsg || t('drama.copyrightProcessing'))}

          {/* Step: characters - 显示所有角色，按主次分组 */}
          {step === 'characters' && project && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-400">{t('drama.confirmCharHint')}</p>
                <div className="flex gap-1.5 flex-shrink-0">
                  {/* 一键批量生图 */}
                  {!batchCharImageRunning && project.novel.characters.some(c => c.role !== 'minor' && !c.confirmed) && (
                    <button onClick={handleBatchCharImages}
                      className="text-[10px] px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white transition-colors whitespace-nowrap">
                      {t('drama.batchGenImages') || '批量生图'}
                    </button>
                  )}
                  {batchCharImageRunning && (
                    <button onClick={() => { batchCharImageAbort.current = true; }}
                      className="text-[10px] px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors whitespace-nowrap">
                      {t('drama.stopBatch') || '停止批量'}
                    </button>
                  )}
                  <button onClick={async () => {
                    setLoading(true);
                    setError('');
                    const data = await apiCall(`/api/drama/${project.id}/refresh-prompts`, 'POST');
                    if (data?.project) setProject(data.project);
                    setLoading(false);
                  }}
                    disabled={loading}
                    className="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-400 transition-colors whitespace-nowrap">
                    {loading ? '...' : t('drama.refreshPrompts')}
                  </button>
                </div>
              </div>
              {/* 主角和配角 - 需要生成角色图并确认 */}
              {project.novel.characters.filter(c => c.role !== 'minor').map((char) => {
                const progress = charImageProgress[char.id];
                const isGenerating = progress?.generating;
                const selected = selectedImages[char.id];
                return (
                <div key={char.id} className="bg-[#111] rounded-xl p-3 border border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-green-400" />
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
                        {char.imageUrls.length === 0 && !isGenerating && (
                          <button onClick={() => handleGenerateCharImage(char.id)}
                            className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white transition-colors">
                            {t('drama.genImage')}
                          </button>
                        )}
                        {char.imageUrls.length > 0 && !isGenerating && (
                          <>
                            <button onClick={() => handleGenerateCharImage(char.id)}
                              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                              {t('drama.genImage')}
                            </button>
                            <button onClick={() => handleConfirmCharacter(char.id)} disabled={loading}
                              className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white transition-colors">
                              {t('common.confirm')}{selected && selected.size > 0 ? ` (${selected.size})` : ''}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{char.description}</p>
                  {/* 参考图区域 */}
                  {!char.confirmed && (
                    <div className="mb-2 flex items-center gap-2">
                      {(char as CharacterInfo & { refImageUrl?: string }).refImageUrl ? (
                        <div className="relative group flex-shrink-0">
                          <img src={(char as CharacterInfo & { refImageUrl?: string }).refImageUrl}
                            alt="参考图" loading="lazy" className="w-16 h-20 object-cover rounded border border-cyan-700/50" />
                          <button onClick={() => handleRemoveCharRefImage(char.id)}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <CloseIcon className="w-2.5 h-2.5 text-white" />
                          </button>
                          <span className="text-[9px] text-cyan-500 block text-center mt-0.5">{t('drama.refImage') || '参考图'}</span>
                        </div>
                      ) : (
                        <label className="flex-shrink-0 w-16 h-20 border border-dashed border-gray-600 rounded flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500 transition-colors">
                          {charRefUploading[char.id] ? (
                            <div className="w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <span className="text-gray-500 text-lg leading-none">+</span>
                              <span className="text-[9px] text-gray-600 mt-0.5">{t('drama.uploadRef') || '参考图'}</span>
                            </>
                          )}
                          <input type="file" accept="image/*" className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleUploadCharRefImage(char.id, file);
                              e.target.value = '';
                            }} />
                        </label>
                      )}
                    </div>
                  )}
                  {/* 进度条 */}
                  {isGenerating && (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-green-400">
                          {t('drama.genImageProgress', { done: progress.done, total: progress.total })}
                        </span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                      </div>
                    </div>
                  )}
                  {/* 图片网格（可勾选+可预览） */}
                  {char.imageUrls.length > 0 && (
                    <div>
                      {!char.confirmed && char.imageUrls.length > 0 && (
                        <p className="text-[10px] text-gray-600 mb-1">{t('drama.selectImages')}</p>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        {char.imageUrls.map((url, i) => {
                          const isSelected = selected?.has(url);
                          return (
                            <div key={i} className="relative group">
                              <img src={url} alt={`${char.newName} ${i + 1}`}
                                loading="lazy"
                                className={`w-20 h-24 object-cover rounded-lg border-2 cursor-pointer transition-all ${
                                  isSelected ? 'border-green-500 ring-1 ring-green-500/50' : 'border-white/10 hover:border-gray-500'
                                }`}
                                onClick={() => !char.confirmed && toggleImageSelection(char.id, url)} />
                              {/* 勾选标记 */}
                              {!char.confirmed && isSelected && (
                                <div className="absolute top-1 right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                  <CheckIcon className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                              {/* 预览按钮 */}
                              <button onClick={(e) => { e.stopPropagation(); setPreviewImage(url); }}
                                className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/70 rounded text-[9px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                                {t('drama.previewImage')}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
              {/* 场景列表 - 生成场景参考图 */}
              {project.novel.locations.length > 0 && (
                <details className="bg-[#111] rounded-xl border border-white/5" open>
                  <summary className="px-3 py-2 text-xs text-green-400 cursor-pointer hover:text-green-300 transition-colors font-medium flex items-center justify-between">
                    <span>{t('drama.locations')} ({project.novel.locations.length})</span>
                    <span className="flex gap-1.5" onClick={e => e.preventDefault()}>
                      {!batchLocImageRunning && project.novel.locations.some(l => !l.imageUrl) && (
                        <button onClick={handleBatchLocImages}
                          className="text-[10px] px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors">
                          {t('drama.batchGenImages') || '批量生图'}
                        </button>
                      )}
                      {batchLocImageRunning && (
                        <button onClick={() => { batchLocImageAbort.current = true; }}
                          className="text-[10px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors">
                          {t('drama.stopBatch') || '停止批量'}
                        </button>
                      )}
                    </span>
                  </summary>
                  <div className="px-3 pb-2 space-y-2">
                    {project.novel.locations.map(loc => (
                      <div key={loc.id} className="flex items-center gap-2 text-xs py-1">
                        {loc.imageUrl ? (
                          <div className="relative group flex-shrink-0">
                            <img src={loc.imageUrl} alt={loc.newName}
                              loading="lazy"
                              className="w-16 h-10 object-cover rounded border border-white/10 cursor-pointer"
                              onClick={() => setPreviewImage(loc.imageUrl!)} />
                            <button onClick={() => handleGenerateLocImage(loc.id)}
                              className="absolute inset-0 bg-black/50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[9px] text-white">
                              {t('drama.regenImage')}
                            </button>
                          </div>
                        ) : (
                          <div className="w-16 h-10 bg-gray-800 rounded border border-white/10 flex items-center justify-center flex-shrink-0">
                            {locImageGenerating[loc.id] ? (
                              <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <button onClick={() => handleGenerateLocImage(loc.id)}
                                className="text-[9px] text-gray-500 hover:text-green-400 transition-colors">
                                {t('drama.genSceneImage')}
                              </button>
                            )}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-gray-300">{loc.newName}</span>
                          {loc.originalName !== loc.newName && (
                            <span className="text-gray-700 ml-1">← {loc.originalName}</span>
                          )}
                          <p className="text-gray-600 truncate">{loc.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {/* 龙套角色 - 折叠显示，无需生成图片 */}
              {project.novel.characters.filter(c => c.role === 'minor').length > 0 && (
                <details className="bg-[#111] rounded-xl border border-white/5">
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
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-600 to-green-500 text-white font-bold transition-all flex items-center justify-center gap-2">
                  <ArrowRightIcon className="w-4 h-4" />{loading ? t('common.loading') : t('drama.genScript')}
                </button>
              )}
            </div>
          )}

          {/* Step: scripting (LLM 自动处理中) */}
          {step === 'scripting' && loading && renderLoading(progressMsg || t('drama.scriptGenerating'))}
          {step === 'scripting' && !loading && (
            <div className="space-y-4">
              {project && project.episodes.length > 0 ? (
                <>
                  <p className="text-sm text-gray-400">{t('drama.readySummary', { title: project.novel.title, episodes: project.episodes.length })}</p>
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {project.episodes.map(ep => (
                      <details key={ep.number} className="bg-[#111] rounded-lg border border-white/5 text-xs">
                        <summary className="p-2.5 flex items-center gap-2 cursor-pointer hover:bg-white/5/30 transition-colors">
                          <span className="text-green-400 flex-shrink-0">E{String(ep.number).padStart(2, '0')}</span>
                          <span className="text-gray-300 truncate flex-1">{ep.title}</span>
                          <span className="text-gray-600 flex-shrink-0">[{ep.act}]</span>
                        </summary>
                        <div className="px-2.5 pb-2.5 border-t border-white/5/50">
                          <textarea
                            value={editingEpisodes[ep.number] ?? ep.prompt}
                            onChange={(e) => setEditingEpisodes(prev => ({ ...prev, [ep.number]: e.target.value }))}
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-gray-300 outline-none focus:border-green-500/50 mt-2 min-h-[120px] resize-y font-mono leading-relaxed"
                          />
                          {editingEpisodes[ep.number] !== undefined && editingEpisodes[ep.number] !== ep.prompt && (
                            <div className="flex gap-2 mt-1.5">
                              <button onClick={async () => {
                                const updatedEpisodes = project.episodes.map(e =>
                                  e.number === ep.number ? { ...e, prompt: editingEpisodes[ep.number] } : e
                                );
                                await apiCall(`/api/drama/${project.id}/update-episodes`, 'POST', { episodes: updatedEpisodes });
                                const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
                                if (projData?.project) setProject(projData.project);
                                setEditingEpisodes(prev => { const n = { ...prev }; delete n[ep.number]; return n; });
                              }}
                                className="text-[10px] px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white transition-colors">
                                {t('common.save')}
                              </button>
                              <button onClick={() => setEditingEpisodes(prev => { const n = { ...prev }; delete n[ep.number]; return n; })}
                                className="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                                {t('common.cancel')}
                              </button>
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                  <button onClick={() => setStep('ready')}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold transition-all flex items-center justify-center gap-2">
                    <ArrowRightIcon className="w-4 h-4" />{t('drama.nextStep')}
                  </button>
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-400 mb-4">{t('drama.confirmCharHint')}</p>
                  <button onClick={handleGenerateScript}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold transition-all inline-flex items-center gap-2">
                    <SparkleIcon className="w-4 h-4" />{t('drama.genScript')}
                  </button>
                </div>
              )}
            </div>
          )}

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

              {/* 创意优化进度 */}
              {optimizing && (
                <div className="bg-[#111] rounded-xl p-3 border border-green-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-green-300">{t('drama.optimizeInProgress')}</span>
                  </div>
                  <p className="text-xs text-gray-400">{optimizeProgress}</p>
                </div>
              )}

              {/* 参考图生成进度 */}
              {generatingRefImages && (
                <div className="bg-[#111] rounded-xl p-3 border border-cyan-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-cyan-300">{t('drama.refImageInProgress')}</span>
                  </div>
                  <p className="text-xs text-gray-400">{refImageProgress}</p>
                </div>
              )}

              {/* 批量生成进度 */}
              {batchGenerating && (
                <div className="bg-[#111] rounded-xl p-3 border border-green-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-green-300">{t('drama.batchInProgress')}</span>
                  </div>
                  <p className="text-xs text-gray-400">{batchProgress}</p>
                </div>
              )}

              {/* 每集状态列表（可展开查看/编辑脚本） */}
              {project.episodes.length > 0 && (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {project.episodes.map(ep => (
                    <details key={ep.number} className={`bg-[#111] rounded-lg border text-xs ${
                      ep.videoStatus === 'done' ? 'border-green-700/50' :
                      ep.videoStatus === 'generating' ? 'border-yellow-700/50' :
                      ep.videoStatus === 'error' ? 'border-red-700/50' : 'border-white/5'
                    }`}>
                      <summary className="p-2.5 flex items-center gap-2 cursor-pointer hover:bg-white/5/30 transition-colors">
                        {/* 状态图标 */}
                        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                          {ep.videoStatus === 'done' && <CheckIcon className="w-4 h-4 text-green-400" />}
                          {ep.videoStatus === 'generating' && <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />}
                          {ep.videoStatus === 'error' && <span className="text-red-400">✗</span>}
                          {(!ep.videoStatus || ep.videoStatus === 'pending') && <span className="text-gray-600">○</span>}
                        </div>
                        <span className="text-green-400 flex-shrink-0">E{String(ep.number).padStart(2, '0')}</span>
                        <span className="text-gray-300 truncate flex-1">{ep.title}</span>
                        <span className="text-gray-600 flex-shrink-0">[{ep.act}]</span>
                        {/* 优化分数 */}
                        {ep.score != null && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${
                            ep.score >= 8 ? 'bg-green-900/50 text-green-400' :
                            ep.score >= 6 ? 'bg-yellow-900/50 text-yellow-400' :
                            'bg-red-900/50 text-red-400'
                          }`}>{ep.score}分</span>
                        )}
                        {/* 单集优化按钮 */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOptimizeSingle(ep.number); }}
                          disabled={optimizingEp[ep.number]}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-green-600/50 hover:bg-green-500/50 text-green-300 flex-shrink-0 transition-colors disabled:opacity-50"
                          title={t('drama.optimizeSingle')}
                        >
                          {optimizingEp[ep.number] ? (
                            <div className="w-3 h-3 border border-green-400 border-t-transparent rounded-full animate-spin" />
                          ) : '✦'}
                        </button>
                        {ep.videoStatus === 'done' && ep.videoUrl && (
                          <a href={`/api/video-proxy?url=${encodeURIComponent(ep.videoUrl)}`}
                            target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="text-green-400 hover:text-green-300 flex-shrink-0 underline">
                            {t('drama.watchVideo')}
                          </a>
                        )}
                        {ep.videoStatus === 'error' && ep.videoError && (
                          <span className="text-red-400 truncate max-w-[120px]" title={ep.videoError}>
                            {ep.videoError.substring(0, 20)}...
                          </span>
                        )}
                      </summary>
                      <div className="px-2.5 pb-2.5 border-t border-white/5/50">
                        {/* 参考图预览 + 单集重新生成 */}
                        <div className="flex items-center gap-1.5 mt-2 mb-1.5 flex-wrap">
                          {ep.refImageUrls && ep.refImageUrls.length > 0 && ep.refImageUrls.map((url, ri) => (
                            <img key={ri} src={url} alt={`ref ${ri + 1}`}
                              loading="lazy"
                              className="w-16 h-10 object-cover rounded border border-white/10 cursor-pointer hover:border-cyan-500 transition-colors"
                              onClick={() => setPreviewImage(url)} />
                          ))}
                          {ep.refImageUrls && ep.refImageUrls.length > 0 && (
                            <span className="text-[9px] text-cyan-600 self-center ml-1">{t('drama.refImages')}</span>
                          )}
                          <button
                            onClick={() => handleRegenEpRefImages(ep.number)}
                            disabled={regenRefEp[ep.number]}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-700/40 hover:bg-cyan-600/50 text-cyan-300 transition-colors disabled:opacity-50 ml-auto flex-shrink-0"
                            title={t('drama.regenRefImages')}
                          >
                            {regenRefEp[ep.number] ? (
                              <div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : '🔄 ' + t('drama.regenRefImages')}
                          </button>
                        </div>
                        {/* 分镜列表 */}
                        {ep.shots && ep.shots.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="text-[9px] text-gray-500">🎬 {ep.shots.length} 个分镜 · 共 {ep.shots[ep.shots.length - 1]?.endTime || 0}s</div>
                              <button
                                onClick={() => handleRegenShots(ep.number)}
                                disabled={regenShotsEp[ep.number]}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-green-700/40 hover:bg-green-600/50 text-green-300 transition-colors disabled:opacity-50 ml-auto"
                              >
                                {regenShotsEp[ep.number] ? (
                                  <div className="w-3 h-3 border border-green-400 border-t-transparent rounded-full animate-spin inline-block" />
                                ) : '🔄 ' + t('drama.regenShots')}
                              </button>
                            </div>
                            {ep.shots.map((shot) => (
                              <details key={shot.index} className={`bg-[#0a0a0a] rounded border text-[10px] ${
                                shot.videoStatus === 'done' ? 'border-green-800/50' :
                                shot.videoStatus === 'generating' ? 'border-yellow-800/50' :
                                shot.videoStatus === 'error' ? 'border-red-800/50' : 'border-white/5/50'
                              }`}>
                                <summary className="flex items-center gap-1.5 p-1.5 cursor-pointer select-none hover:bg-white/5">
                                  <span className="text-green-400 font-mono">S{String(shot.index).padStart(2, '0')}</span>
                                  <span className="text-gray-500">{shot.startTime}-{shot.endTime}s</span>
                                  {shot.transition && <span className="text-yellow-600 text-[9px]">→ {shot.transition}</span>}
                                  {shot.videoStatus === 'done' && <span className="text-green-400 text-[9px]">✓</span>}
                                  {shot.videoStatus === 'generating' && <div className="w-2 h-2 border border-yellow-400 border-t-transparent rounded-full animate-spin" />}
                                  {shot.videoStatus === 'error' && <span className="text-red-400 text-[9px]">✗</span>}
                                  <span className="text-gray-500 ml-auto truncate max-w-[120px]">{shot.prompt.split('\n')[0]}</span>
                                </summary>
                                <div className="px-2 pb-2 space-y-1">
                                  {/* 关联角色 */}
                                  {shot.characterRefs?.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="text-gray-500">{t('drama.shotCharacters')}:</span>
                                      {shot.characterRefs.map(cid => {
                                        const char = project.novel?.characters?.find((c: CharacterInfo) => c.id === cid);
                                        return <span key={cid} className="px-1 py-0.5 rounded bg-blue-900/40 text-blue-300 text-[9px]">{char?.newName || cid}</span>;
                                      })}
                                    </div>
                                  )}
                                  {/* 关联场景 */}
                                  {shot.locationRefs?.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="text-gray-500">{t('drama.shotLocations')}:</span>
                                      {shot.locationRefs.map(lid => {
                                        const loc = project.novel?.locations?.find((l: LocationInfo) => l.id === lid);
                                        return <span key={lid} className="px-1 py-0.5 rounded bg-emerald-900/40 text-emerald-300 text-[9px]">{loc?.newName || lid}</span>;
                                      })}
                                    </div>
                                  )}
                                  {/* 完整 prompt */}
                                  <pre className="text-gray-400 whitespace-pre-wrap text-[9px] leading-relaxed mt-1 max-h-[200px] overflow-y-auto">{shot.prompt}</pre>
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                        {/* 整集脚本编辑 */}
                        <textarea
                          value={editingEpisodes[ep.number] ?? ep.prompt}
                          onChange={(e) => setEditingEpisodes(prev => ({ ...prev, [ep.number]: e.target.value }))}
                          className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-gray-300 outline-none focus:border-green-500/50 mt-2 min-h-[120px] resize-y font-mono leading-relaxed"
                        />
                        {editingEpisodes[ep.number] !== undefined && editingEpisodes[ep.number] !== ep.prompt && (
                          <div className="flex gap-2 mt-1.5">
                            <button onClick={async () => {
                              // 保存编辑的脚本到后端
                              const updatedEpisodes = project.episodes.map(e =>
                                e.number === ep.number ? { ...e, prompt: editingEpisodes[ep.number] } : e
                              );
                              await apiCall(`/api/drama/${project.id}/update-episodes`, 'POST', { episodes: updatedEpisodes });
                              const projData = await apiCall(`/api/drama/${project.id}`, 'GET');
                              if (projData?.project) setProject(projData.project);
                              setEditingEpisodes(prev => { const n = { ...prev }; delete n[ep.number]; return n; });
                            }}
                              className="text-[10px] px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white transition-colors">
                              {t('common.save')}
                            </button>
                            <button onClick={() => setEditingEpisodes(prev => { const n = { ...prev }; delete n[ep.number]; return n; })}
                              className="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                              {t('common.cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              {/* 操作按钮 */}
              {!batchGenerating && !optimizing && !generatingRefImages && (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={handleOptimizeScripts}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold transition-all flex items-center justify-center gap-2">
                    <SparkleIcon className="w-4 h-4" />{t('drama.optimizeScripts')}
                  </button>
                  <button onClick={handleGenerateRefImages}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold transition-all flex items-center justify-center gap-2">
                    <SparkleIcon className="w-4 h-4" />{t('drama.genRefImages')}
                  </button>
                  <button onClick={handleBatchGenerate} disabled={loading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-700 text-white font-bold transition-all flex items-center justify-center gap-2">
                    <SparkleIcon className="w-4 h-4" />
                    {project.episodes.some(e => e.videoStatus === 'done')
                      ? t('drama.batchRetry')
                      : t('drama.batchStart')}
                  </button>
                </div>
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
        {stepIndex > 0 && step !== 'drafts' && !loading && (
          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
            <button onClick={() => {
              const prevSteps: Record<Step, Step> = {
                drafts: 'drafts', setup: 'drafts', novel: 'setup', analyzing: 'setup', review: 'setup',
                copyright: 'review', characters: 'review', scripting: 'characters', ready: 'scripting',
              };
              setStep(prevSteps[step]);
            }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors">
              <ArrowLeftIcon className="w-3 h-3" />{t('drama.prevStep')}
            </button>
            {step === 'ready' && !batchGenerating && (
              <button onClick={handleGenerateScript}
                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors">
                <SparkleIcon className="w-3 h-3" />{t('drama.regenScript')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 图片预览弹窗 */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setPreviewImage(null)}>
          <div className="absolute inset-0 bg-black/80" />
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
            <button onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full hover:bg-black/80 transition-colors">
              <CloseIcon className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
