// 项目工作台 - MkAnime 风格全屏工作界面
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DramaProject, CharacterInfo, EpisodeScript, WorkspaceTab } from '../types/drama';
import { statusToDefaultTab } from '../types/drama';
import { loadSettings } from './SettingsModal';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CloseIcon, SparkleIcon, UserIcon } from './Icons';
import { uploadMaterials } from '../services/uploadService';
import { computeSpatialLayout } from '../utils/spatialLayout';

// Tab 图标组件
function TabIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || 'w-5 h-5';
  switch (type) {
    case 'outline':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M4 6h16M4 10h16M4 14h10M4 18h6" /></svg>;
    case 'script':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
    case 'characters':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case 'materials':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    default:
      return null;
  }
}

// 批量下载图片
function downloadAllImages(items: { url: string; name: string }[]) {
  items.forEach(({ url, name }) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

interface ProjectWorkspaceProps {
  projectId: string;
  sessionId: string;
  onBack: () => void;
}

export default function ProjectWorkspace({ projectId, sessionId, onBack }: ProjectWorkspaceProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const [project, setProject] = useState<DramaProject | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('outline');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // 角色图生成进度
  const [charImageProgress, setCharImageProgress] = useState<Record<string, { done: number; total: number; generating: boolean }>>({});
  const charImageProgressRef = useRef(charImageProgress);
  useEffect(() => { charImageProgressRef.current = charImageProgress; }, [charImageProgress]);
  const [selectedImages, setSelectedImages] = useState<Record<string, Set<string>>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const charWsRefs = useRef<Map<string, WebSocket>>(new Map());
  const [locImageGenerating, setLocImageGenerating] = useState<Record<string, boolean>>({});
  const [expandedLocId, setExpandedLocId] = useState<string | null>(null);
  const locImageGeneratingRef = useRef(locImageGenerating);
  useEffect(() => { locImageGeneratingRef.current = locImageGenerating; }, [locImageGenerating]);
  const [editingEpisodes, setEditingEpisodes] = useState<Record<number, string>>({});
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState('');
  const [optimizingEp, setOptimizingEp] = useState<Record<number, boolean>>({});
  const [generatingRefImages, setGeneratingRefImages] = useState(false);
  const [refImageProgress, setRefImageProgress] = useState('');
  const [batchCharImageRunning, setBatchCharImageRunning] = useState(false);
  const batchCharImageAbort = useRef(false);
  const [charRefUploading, setCharRefUploading] = useState<Record<string, boolean>>({});
  const [batchLocImageRunning, setBatchLocImageRunning] = useState(false);
  const batchLocImageAbort = useRef(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [regenRefEp, setRegenRefEp] = useState<Record<number, boolean>>({});
  const [regenShotsEp, setRegenShotsEp] = useState<Record<number, boolean>>({});
  const [matFilter, setMatFilter] = useState<'all' | 'images' | 'videos'>('all');
  // 分析进度
  const [analyzeProgress, setAnalyzeProgress] = useState('');
  const analyzeWsRef = useRef<WebSocket | null>(null);
  const analyzePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载项目
  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/drama/${projectId}`);
      const data = await res.json();
      if (data?.project) {
        setProject(data.project);
        if (!project) setActiveTab(statusToDefaultTab(data.project.status));
      }
    } catch { /* ignore */ }
  }, [projectId, project]);

  useEffect(() => { loadProject(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 通用 API
  const apiCall = useCallback(async (url: string, method = 'POST', body?: Record<string, unknown>) => {
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

  const refreshProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/drama/${projectId}`);
      const data = await res.json();
      if (data?.project) setProject(data.project);
    } catch { /* ignore */ }
  }, [projectId]);

  // 清理 WebSocket
  useEffect(() => {
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (analyzeWsRef.current) { analyzeWsRef.current.close(); analyzeWsRef.current = null; }
      if (analyzePollRef.current) { clearInterval(analyzePollRef.current); analyzePollRef.current = null; }
      for (const ws of charWsRefs.current.values()) ws.close();
      charWsRefs.current.clear();
    };
  }, []);

  // 当项目处于 analyzing 状态时，自动监听分析进度
  useEffect(() => {
    if (!project || project.status !== 'analyzing') return;
    // 避免重复订阅
    if (analyzeWsRef.current || analyzePollRef.current) return;

    const taskId = `analyze_${projectId}`;
    setAnalyzeProgress(isZh ? '大模型正在分析小说，请耐心等待...' : 'AI is analyzing the novel, please wait...');

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    analyzeWsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;
        if (msg.type === 'task_progress') {
          setAnalyzeProgress(msg.data?.progress || '');
        } else if (msg.type === 'task_done') {
          ws.close(); analyzeWsRef.current = null;
          setAnalyzeProgress('');
          await refreshProject();
        } else if (msg.type === 'task_error') {
          ws.close(); analyzeWsRef.current = null;
          setAnalyzeProgress('');
          setError(msg.data?.error || (isZh ? '分析失败' : 'Analysis failed'));
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      analyzeWsRef.current = null;
      // WebSocket 失败，降级轮询
      if (!analyzePollRef.current) {
        analyzePollRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/drama/${projectId}`);
            const data = await res.json();
            if (data?.project && data.project.status !== 'analyzing') {
              clearInterval(analyzePollRef.current!);
              analyzePollRef.current = null;
              setAnalyzeProgress('');
              setProject(data.project);
              setActiveTab(statusToDefaultTab(data.project.status));
            }
          } catch { /* ignore */ }
        }, 5000);
      }
    };

    return () => {
      if (analyzeWsRef.current) { analyzeWsRef.current.close(); analyzeWsRef.current = null; }
      if (analyzePollRef.current) { clearInterval(analyzePollRef.current); analyzePollRef.current = null; }
    };
  }, [project?.status, projectId, refreshProject, isZh]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 版权改造 ----
  const handleStartCopyright = async () => {
    if (!project) return;
    setLoading(true);
    setProgressMsg(t('drama.copyrightProcessing'));
    const data = await apiCall(`/api/drama/${projectId}/copyright`, 'POST', {});
    if (data?.project) { setProject(data.project); setActiveTab('characters'); }
    setLoading(false);
  };

  // ---- 刷新角色/场景提示词 ----
  const handleRefreshPrompts = async () => {
    if (!project) return;
    setLoading(true);
    setProgressMsg(isZh ? '正在重新生成角色和场景的提示词...' : 'Refreshing visual prompts...');
    try {
      const res = await fetch(`/api/drama/${projectId}/refresh-prompts`, { method: 'POST' });
      if (res.ok) await refreshProject();
      else { const d = await res.json(); setError(d.error || '刷新失败'); }
    } catch (err) { setError((err as Error).message); }
    setLoading(false);
  };

  // ---- 重新生成标题和摘要 ----
  const handleRefreshSummary = async () => {
    if (!project) return;
    setLoading(true);
    setProgressMsg(isZh ? '正在重新生成标题和摘要...' : 'Refreshing title and summary...');
    try {
      const res = await fetch(`/api/drama/${projectId}/refresh-summary`, { method: 'POST' });
      if (res.ok) await refreshProject();
      else { const d = await res.json(); setError(d.error || '生成失败'); }
    } catch (err) { setError((err as Error).message); }
    setLoading(false);
  };

  // ---- 角色图生成 ----
  const handleGenerateCharImage = async (characterId: string) => {
    if (!project) return;
    const { maxConcurrentChars } = loadSettings();
    const currentGenerating = Object.values(charImageProgress).filter(p => p.generating).length;
    if (currentGenerating >= maxConcurrentChars) return;

    const taskId = `charimg_${projectId}_${characterId}`;
    setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: true } }));

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    charWsRefs.current.set(characterId, ws);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;
        const pd = msg.data?.progress ? JSON.parse(msg.data.progress) : {};
        if (msg.type === 'task_progress') {
          setCharImageProgress(prev => ({ ...prev, [characterId]: { done: pd.done || 0, total: pd.total || 3, generating: true } }));
        } else if (msg.type === 'task_done') {
          setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 3, total: 3, generating: false } }));
          ws.close(); charWsRefs.current.delete(characterId);
          await refreshProject();
        } else if (msg.type === 'task_error') {
          setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: false } }));
          setError(msg.data?.error || t('drama.genImageFailed'));
          ws.close(); charWsRefs.current.delete(characterId);
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      const poll = setInterval(async () => {
        const d = await fetch(`/api/drama/${projectId}`).then(r => r.json()).catch(() => null);
        if (d?.project) {
          const c = d.project.novel.characters.find((ch: CharacterInfo) => ch.id === characterId);
          if (c && c.imageUrls.length > 0) {
            clearInterval(poll); setProject(d.project);
            setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 3, total: 3, generating: false } }));
          }
        }
      }, 5000);
    };
    try {
      await fetch(`/api/drama/${projectId}/generate-character-images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, characterId }),
      });
    } catch (err) {
      setError((err as Error).message);
      setCharImageProgress(prev => ({ ...prev, [characterId]: { done: 0, total: 3, generating: false } }));
    }
  };

  // 批量角色图
  const handleBatchCharImages = async () => {
    if (!project || batchCharImageRunning) return;
    batchCharImageAbort.current = false;
    setBatchCharImageRunning(true);
    const { maxConcurrentChars } = loadSettings();
    const pending = project.novel.characters.filter(c => c.role !== 'minor' && !c.confirmed);
    if (!pending.length) { setBatchCharImageRunning(false); return; }
    const queue = [...pending.map(c => c.id)];
    const active = new Set<string>();
    const startOne = (id: string) => { active.add(id); handleGenerateCharImage(id); };
    queue.splice(0, maxConcurrentChars).forEach(startOne);
    const iv = setInterval(() => {
      if (batchCharImageAbort.current) { clearInterval(iv); setBatchCharImageRunning(false); return; }
      const cp = charImageProgressRef.current;
      for (const id of active) { if (cp[id] && !cp[id].generating) { active.delete(id); if (queue.length) startOne(queue.shift()!); } }
      if (!active.size && !queue.length) { clearInterval(iv); setBatchCharImageRunning(false); }
    }, 1000);
  };

  // 上传角色参考图
  const handleUploadCharRefImage = async (characterId: string, file: File) => {
    setCharRefUploading(prev => ({ ...prev, [characterId]: true }));
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('characterId', characterId);
      const res = await fetch(`/api/drama/${projectId}/upload-char-ref-image`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || '上传失败');
      await refreshProject();
    } catch (err) { setError((err as Error).message); }
    finally { setCharRefUploading(prev => ({ ...prev, [characterId]: false })); }
  };

  const handleRemoveCharRefImage = async (characterId: string) => {
    await fetch(`/api/drama/${projectId}/remove-char-ref-image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId }),
    });
    await refreshProject();
  };

  const toggleImageSelection = (characterId: string, imageUrl: string) => {
    setSelectedImages(prev => {
      const s = new Set(prev[characterId] || []);
      s.has(imageUrl) ? s.delete(imageUrl) : s.add(imageUrl);
      return { ...prev, [characterId]: s };
    });
  };

  const handleConfirmCharacter = async (characterId: string) => {
    const sel = selectedImages[characterId];
    const ch = project?.novel.characters.find(c => c.id === characterId);
    const urls = sel && sel.size > 0 ? Array.from(sel) : ch?.imageUrls || [];
    await apiCall(`/api/drama/${projectId}/confirm-character`, 'POST', { characterId, selectedImageUrls: urls });
    await refreshProject();
  };

  // 场景图
  const handleGenerateLocImage = async (locationId: string) => {
    setLocImageGenerating(prev => ({ ...prev, [locationId]: true }));
    const taskId = `locimg_${projectId}_${locationId}`;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    charWsRefs.current.set(`loc_${locationId}`, ws);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;
        if (msg.type === 'task_done') { ws.close(); charWsRefs.current.delete(`loc_${locationId}`); setLocImageGenerating(prev => ({ ...prev, [locationId]: false })); await refreshProject(); }
        else if (msg.type === 'task_error') { ws.close(); charWsRefs.current.delete(`loc_${locationId}`); setLocImageGenerating(prev => ({ ...prev, [locationId]: false })); setError(msg.data?.error || ''); }
      } catch { /* ignore */ }
    };
    ws.onerror = () => setLocImageGenerating(prev => ({ ...prev, [locationId]: false }));
    try {
      await fetch(`/api/drama/${projectId}/generate-location-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, locationId }),
      });
    } catch (err) { setError((err as Error).message); setLocImageGenerating(prev => ({ ...prev, [locationId]: false })); }
  };

  const handleBatchLocImages = async () => {
    if (!project || batchLocImageRunning) return;
    batchLocImageAbort.current = false; setBatchLocImageRunning(true);
    const { maxConcurrentChars } = loadSettings();
    const pending = project.novel.locations.filter(l => !l.imageUrl && !(l.imageUrls && l.imageUrls.length > 0));
    if (!pending.length) { setBatchLocImageRunning(false); return; }
    const queue = [...pending.map(l => l.id)]; const active = new Set<string>();
    const startOne = (id: string) => { active.add(id); handleGenerateLocImage(id); };
    queue.splice(0, maxConcurrentChars).forEach(startOne);
    const iv = setInterval(() => {
      if (batchLocImageAbort.current) { clearInterval(iv); setBatchLocImageRunning(false); return; }
      for (const id of active) { if (!locImageGeneratingRef.current[id]) { active.delete(id); if (queue.length) startOne(queue.shift()!); } }
      if (!active.size && !queue.length) { clearInterval(iv); setBatchLocImageRunning(false); }
    }, 1000);
  };

  // 确认场景图（从候选中选1张，删除其他）
  const handleConfirmLocImage = async (locationId: string, selectedUrl: string) => {
    try {
      const res = await fetch(`/api/drama/${projectId}/confirm-location-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, selectedImageUrl: selectedUrl }),
      });
      if (res.ok) {
        setExpandedLocId(null);
        await refreshProject();
      }
    } catch (err) { setError((err as Error).message); }
  };

  // ---- 脚本生成 ----
  const handleGenerateScript = async () => {
    setLoading(true); setProgressMsg(t('drama.scriptGenerating')); setError('');
    try {
      const res = await fetch(`/api/drama/${projectId}/generate-script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      if (data.async && data.taskId) {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
        wsRef.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId: data.taskId }));
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.taskId !== data.taskId) return;
            if (msg.type === 'task_progress') setProgressMsg(msg.data?.progress || '');
            else if (msg.type === 'task_done') { ws.close(); await refreshProject(); setLoading(false); }
            else if (msg.type === 'task_error') { ws.close(); setError(msg.data?.error || ''); setLoading(false); }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {
          const poll = setInterval(async () => {
            const d = await fetch(`/api/drama/${projectId}`).then(r => r.json()).catch(() => null);
            if (d?.project?.status === 'ready') { clearInterval(poll); setProject(d.project); setLoading(false); }
          }, 5000);
        };
      } else if (data.project) { setProject(data.project); setLoading(false); }
    } catch (err) { setError((err as Error).message); setLoading(false); }
  };

  // 创意优化
  const handleOptimizeScripts = async () => {
    setOptimizing(true); setOptimizeProgress(t('drama.optimizeStarting')); setError('');
    try {
      const res = await fetch(`/api/drama/${projectId}/optimize-scripts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
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
            if (msg.type === 'task_progress') setOptimizeProgress(msg.data?.progress || '');
            else if (msg.type === 'task_done') { ws.close(); await refreshProject(); setOptimizing(false); }
            else if (msg.type === 'task_error') { ws.close(); setError(msg.data?.error || ''); setOptimizing(false); }
          } catch { /* ignore */ }
        };
        ws.onerror = () => { setOptimizing(false); };
      }
    } catch (err) { setError((err as Error).message); setOptimizing(false); }
  };

  const handleOptimizeSingle = async (epNum: number) => {
    setOptimizingEp(prev => ({ ...prev, [epNum]: true })); setError('');
    try {
      const res = await fetch(`/api/drama/${projectId}/optimize-single`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeNumber: epNum }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.project) setProject(data.project);
    } catch (err) { setError((err as Error).message); }
    finally { setOptimizingEp(prev => ({ ...prev, [epNum]: false })); }
  };

  const handleRegenShots = async (epNum: number) => {
    setRegenShotsEp(prev => ({ ...prev, [epNum]: true })); setError('');
    try { const data = await apiCall(`/api/drama/${projectId}/regenerate-shots`, 'POST', { episodeNumber: epNum }); if (data?.project) setProject(data.project); }
    catch (err) { setError((err as Error).message); }
    finally { setRegenShotsEp(prev => ({ ...prev, [epNum]: false })); }
  };

  const handleRegenEpRefImages = async (epNum: number) => {
    setRegenRefEp(prev => ({ ...prev, [epNum]: true })); setError('');
    try {
      const res = await fetch(`/api/drama/${projectId}/regenerate-ep-ref-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeNumber: epNum, sessionId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.project) setProject(data.project);
    } catch (err) { setError((err as Error).message); }
    finally { setRegenRefEp(prev => ({ ...prev, [epNum]: false })); }
  };

  const handleGenerateRefImages = async () => {
    setGeneratingRefImages(true); setRefImageProgress(t('drama.refImageStarting')); setError('');
    try {
      const res = await fetch(`/api/drama/${projectId}/generate-ref-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
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
            if (msg.type === 'task_progress') setRefImageProgress(msg.data?.progress || '');
            else if (msg.type === 'task_done') { ws.close(); await refreshProject(); setGeneratingRefImages(false); }
            else if (msg.type === 'task_error') { ws.close(); setError(msg.data?.error || ''); setGeneratingRefImages(false); }
          } catch { /* ignore */ }
        };
        ws.onerror = () => { setGeneratingRefImages(false); };
      }
    } catch (err) { setError((err as Error).message); setGeneratingRefImages(false); }
  };

  // 批量视频生成
  const handleBatchGenerate = async () => {
    setBatchGenerating(true); setBatchProgress(t('drama.batchStarting')); setError('');
    const data = await apiCall(`/api/drama/${projectId}/batch-generate`, 'POST', { sessionId });
    if (!data?.batchTaskId) { setBatchGenerating(false); return; }
    const taskId = data.batchTaskId;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.taskId !== taskId) return;
        if (msg.type === 'task_progress') { setBatchProgress(msg.data.progress || ''); refreshProject(); }
        else if (msg.type === 'task_done') { setBatchProgress(msg.data.progress || t('drama.batchComplete')); setBatchGenerating(false); refreshProject(); ws.close(); }
        else if (msg.type === 'task_error') { setError(msg.data.error || ''); setBatchGenerating(false); refreshProject(); ws.close(); }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      setBatchProgress(t('drama.batchPolling'));
      const poll = setInterval(async () => {
        const d = await fetch(`/api/drama/${projectId}`).then(r => r.json()).catch(() => null);
        if (d?.project) {
          setProject(d.project);
          const done = d.project.episodes.filter((e: EpisodeScript) => e.videoStatus === 'done').length;
          const err = d.project.episodes.filter((e: EpisodeScript) => e.videoStatus === 'error').length;
          if (done + err >= d.project.episodes.length || ['batch_done', 'batch_partial'].includes(d.project.status)) { setBatchGenerating(false); clearInterval(poll); }
        }
      }, 10000);
    };
  };

  // ---- 渲染 ----
  if (!project) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const TABS: { key: WorkspaceTab; labelZh: string; labelEn: string; svg: string }[] = [
    { key: 'outline', labelZh: '大纲', labelEn: 'Outline', svg: 'outline' },
    { key: 'script', labelZh: '剧本', labelEn: 'Script', svg: 'script' },
    { key: 'characters', labelZh: '角色', labelEn: 'Characters', svg: 'characters' },
    { key: 'materials', labelZh: '素材', labelEn: 'Materials', svg: 'materials' },
  ];

  const needsCopyright = project.status === 'copyright_check' || project.status === 'copyright';
  const allCharsConfirmed = project.novel.characters.filter(c => c.role !== 'minor').every(c => c.confirmed);
  const hasEpisodes = project.episodes && project.episodes.length > 0;

  return (
    <div className="h-screen flex bg-[#0e0e0e] text-white">
      {/* Left nav - MkAnime 风格 */}
      <aside className="w-[56px] flex-shrink-0 border-r border-white/5 flex flex-col pt-6 gap-2">
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`relative w-full flex flex-col items-center justify-center py-3 gap-1.5 text-[11px] transition-colors ${
                active ? 'text-green-400' : 'text-gray-500 hover:text-gray-300'
              }`}>
              {active && <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-green-500 rounded-r-full" />}
              <TabIcon type={tab.svg} className={`w-5 h-5 ${active ? 'text-green-400' : ''}`} />
              <span>{isZh ? tab.labelZh : tab.labelEn}</span>
            </button>
          );
        })}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 flex items-center gap-4 px-6 border-b border-white/5 flex-shrink-0">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
            <ArrowLeftIcon className="w-5 h-5 text-gray-400" />
          </button>
          <span className="text-base font-semibold text-white truncate">{project.novel.title || 'Untitled'}</span>
          <span className="text-xs text-gray-500 bg-[#1a1a1a] px-2.5 py-1 rounded-md border border-white/5">{project.style}</span>
          <button onClick={() => {/* TODO: settings */}} className="p-2 rounded-lg hover:bg-white/5 transition-colors ml-1">
            <span className="text-gray-500 text-base">⚙</span>
          </button>
        </header>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-xl text-sm text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-3 text-lg">✕</button>
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8">
          {activeTab === 'outline' && renderOutline()}
          {activeTab === 'script' && renderScript()}
          {activeTab === 'characters' && renderCharacters()}
          {activeTab === 'materials' && renderMaterials()}
        </div>
      </div>

      {/* Image preview */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setPreviewImage(null)}>
          <div className="absolute inset-0 bg-black/80" />
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
            <button onClick={() => setPreviewImage(null)} className="absolute top-2 right-2 p-2 bg-black/60 rounded-full hover:bg-black/80">
              <CloseIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // 计算场景→集数映射（复用于空间地图）
  function getLocationEpisodeMap() {
    if (!project?.episodes?.length || !project?.novel?.locations?.length) return new Map<string, number[]>();
    const map = new Map<string, number[]>();
    for (const ep of project.episodes) {
      for (const shot of (ep.shots || [])) {
        for (const locId of (shot.locationRefs || [])) {
          if (!map.has(locId)) map.set(locId, []);
          const arr = map.get(locId)!;
          if (!arr.includes(ep.number)) arr.push(ep.number);
        }
      }
    }
    return map;
  }

  // 空间地图 SVG 可视化
  function renderSpatialMapPanel() {
    if (!project?.novel?.locations?.length || !project.novel.spatialMap) return null;
    const locations = project.novel.locations;
    const relations = project.novel.spatialMap.relations || [];
    const locEpMap = getLocationEpisodeMap();

    const layoutNodes = locations.map((l: Record<string, unknown>) => ({
      id: l.id as string, parentId: l.parentId as string, name: (l.newName || l.originalName) as string, variants: l.variants as unknown[],
    }));
    const { positions, svgWidth, svgHeight, nodeWidth: NW, nodeHeight: NH } = computeSpatialLayout(layoutNodes, relations);

    const locById = new Map(locations.map((l: Record<string, unknown>) => [l.id as string, l]));
    const colors = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4'];

    return (
      <div className="bg-[#111] rounded-2xl border border-white/5 p-4 sticky top-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-green-400 font-medium">🗺️ {isZh ? '空间地图' : 'Spatial Map'}</span>
          {project.episodes?.length > 0 && (
            <span className="text-[10px] text-gray-600">{isZh ? '（标注出现集数）' : '(episode markers)'}</span>
          )}
        </div>
        <div className="overflow-auto custom-scrollbar max-h-[60vh]">
          <svg width={svgWidth} height={svgHeight}>
            {/* 父子连线 */}
            {locations.map((loc: Record<string, unknown>) => {
              if (!loc.parentId) return null;
              const p = positions.get(loc.parentId as string), c = positions.get(loc.id as string);
              if (!p || !c) return null;
              return <line key={`p-${loc.id}`} x1={p.x + NW / 2} y1={p.y + NH} x2={c.x + NW / 2} y2={c.y} stroke="#333" strokeWidth={1.5} strokeDasharray="4,3" />;
            })}
            {/* 相邻关系 */}
            {relations.map((rel: Record<string, unknown>, i: number) => {
              const f = positions.get(rel.from as string), t = positions.get(rel.to as string);
              if (!f || !t) return null;
              const fx = f.x + NW / 2, fy = f.y + NH / 2, tx = t.x + NW / 2, ty = t.y + NH / 2;
              const mx = (fx + tx) / 2, my = (fy + ty) / 2 - 10;
              return (
                <g key={`r-${i}`}>
                  <path d={`M${fx},${fy} Q${mx},${my} ${tx},${ty}`} fill="none"
                    stroke={(rel.bidirectionalView as boolean) ? '#22c55e44' : '#ffffff15'} strokeWidth={1}
                    strokeDasharray={(rel.bidirectionalView as boolean) ? '' : '3,3'} />
                  {rel.direction && <text x={mx} y={my - 4} textAnchor="middle" className="text-[8px] fill-gray-600">{rel.direction as string}</text>}
                </g>
              );
            })}
            {/* 节点 */}
            {Array.from(positions.entries()).map(([id, pos]) => {
              const loc = locById.get(id) as Record<string, unknown> | undefined;
              if (!loc) return null;
              const eps = locEpMap.get(id) || [];
              const color = colors[pos.depth % colors.length];
              const name = (loc.newName || loc.originalName || '') as string;
              const variants = (loc.variants || []) as unknown[];
              return (
                <g key={id}>
                  <rect x={pos.x} y={pos.y} width={NW} height={NH} rx={8} fill="#1a1a1a" stroke={color} strokeWidth={1.5} opacity={0.9} />
                  <text x={pos.x + NW / 2} y={pos.y + 18} textAnchor="middle" className="text-[10px] font-medium" fill="#e5e5e5">
                    {name.length > 8 ? name.slice(0, 8) + '…' : name}
                  </text>
                  {variants.length > 0 && (
                    <text x={pos.x + NW / 2} y={pos.y + 30} textAnchor="middle" className="text-[8px]" fill="#666">🔄 {variants.length}{isZh ? '变体' : 'var'}</text>
                  )}
                  {eps.length > 0 && (
                    <text x={pos.x + NW / 2} y={pos.y + NH - 6} textAnchor="middle" className="text-[8px]" fill={color}>
                      {eps.length <= 5 ? eps.map((n: number) => `E${n}`).join(' ') : `E${eps[0]}…E${eps[eps.length - 1]} (${eps.length})`}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5 flex-wrap">
          <span className="text-[9px] text-gray-600 flex items-center gap-1"><span className="inline-block w-3 h-0 border-t border-dashed border-gray-500" /> {isZh ? '层级' : 'Hierarchy'}</span>
          <span className="text-[9px] text-gray-600 flex items-center gap-1"><span className="inline-block w-3 h-0 border-t border-green-500/30" /> {isZh ? '双向可见' : 'Bidirectional'}</span>
          <span className="text-[9px] text-gray-600 flex items-center gap-1"><span className="inline-block w-3 h-0 border-t border-dashed border-white/15" /> {isZh ? '相邻' : 'Adjacent'}</span>
        </div>
      </div>
    );
  }

  // ==== Tab: 大纲 ====
  function renderOutline() {
    if (!project) return null;
    const isAnalyzing = project.status === 'analyzing';

    // 分析中 - 显示进度
    if (isAnalyzing) {
      return (
        <div className="max-w-4xl space-y-8">
          <div className="bg-[#161616] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-12 h-12 border-3 border-green-500 border-t-transparent rounded-full animate-spin mb-6" />
            <h3 className="text-lg font-semibold text-white mb-3">{isZh ? '正在分析小说...' : 'Analyzing novel...'}</h3>
            <p className="text-sm text-gray-400 text-center max-w-md leading-relaxed">
              {analyzeProgress || (isZh ? '大模型正在处理中，请耐心等待' : 'AI is processing, please wait')}
            </p>
            <p className="text-xs text-gray-600 mt-4">{isZh ? '分析完成后将自动显示结果' : 'Results will appear automatically when done'}</p>
          </div>
        </div>
      );
    }

    // 分析完成后的正常大纲展示
    return (
      <div className="flex gap-6">
        <div className={`space-y-8 ${project.novel.spatialMap ? 'flex-1 min-w-0' : 'max-w-4xl'}`}>
        {/* 分析结果概览 */}
        <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-white">{project.novel.title}</h3>
            <button onClick={handleRefreshSummary} disabled={loading}
              className="text-xs text-gray-500 hover:text-green-400 transition-colors disabled:opacity-50 flex items-center gap-1">
              <SparkleIcon className="w-3 h-3" />{isZh ? '重新生成' : 'Refresh'}
            </button>
          </div>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">{project.novel.summary}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: t('drama.charCount'), value: project.novel.characters.length },
              { label: t('drama.locationCount'), value: project.novel.locations.length },
              { label: t('drama.plotCount'), value: project.novel.plotPoints?.length || 0 },
              { label: t('drama.themeCount'), value: project.novel.themes?.join(', ') || '-' },
            ].map(item => (
              <div key={item.label} className="bg-[#0e0e0e] rounded-xl p-4 border border-white/5">
                <div className="text-xs text-gray-500 mb-1.5">{item.label}</div>
                <div className="text-base text-white font-medium">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          {needsCopyright && (
            <button onClick={handleStartCopyright} disabled={loading}
              className="flex-1 py-4 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-base font-semibold transition-all flex items-center justify-center gap-3">
              <ArrowRightIcon className="w-5 h-5" />{loading ? t('common.loading') : t('drama.startCopyright')}
            </button>
          )}
          <button onClick={handleRefreshPrompts} disabled={loading}
            className={`${needsCopyright ? 'flex-shrink-0 px-6' : 'flex-1'} py-3 rounded-xl border border-white/10 hover:border-green-500/50 text-gray-400 hover:text-green-400 text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50`}>
            <SparkleIcon className="w-4 h-4" />{isZh ? '重新生成提示词' : 'Refresh Prompts'}
          </button>
        </div>

        {/* 情节点（按章节分组） */}
        {project.novel.plotPoints?.length > 0 && (
          <div className="bg-[#161616] rounded-2xl p-6 border border-white/5">
            <h4 className="text-sm font-semibold text-white mb-4">{isZh ? '关键情节（按章节）' : 'Key Plot Points (by Chapter)'}</h4>
            <div className="space-y-5">
              {(() => {
                // 按章节分组
                const grouped = new Map<number, typeof project.novel.plotPoints>();
                for (const pp of project.novel.plotPoints) {
                  if (!grouped.has(pp.chapter)) grouped.set(pp.chapter, []);
                  grouped.get(pp.chapter)!.push(pp);
                }
                // 按章节号排序
                const sorted = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
                return sorted.map(([chapter, points]) => (
                  <div key={chapter}>
                    <div className="text-green-400 text-xs font-mono mb-2">{isZh ? `第${chapter}章` : `Chapter ${chapter}`}</div>
                    <div className="space-y-2 pl-4 border-l border-white/5">
                      {points.map((pp, i) => (
                        <div key={i} className="flex gap-3 text-sm">
                          <span className="text-gray-300 flex-1">{pp.summary}</span>
                          <span className="text-gray-600 flex-shrink-0 text-xs">{pp.emotionalTone}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {loading && progressMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 bg-[#1a1a1a] rounded-2xl px-10 py-8 border border-white/10 shadow-2xl">
              <div className="w-10 h-10 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-300">{progressMsg}</span>
            </div>
          </div>
        )}
        </div>
        {/* 右侧：空间地图 */}
        {project.novel.spatialMap && (
          <div className="min-w-[400px] max-w-[50%] flex-shrink-0">
            {renderSpatialMapPanel()}
          </div>
        )}
      </div>
    );
  }

  // ==== Tab: 角色 ====
  function renderCharacters() {
    if (!project) return null;
    const mainChars = project.novel.characters.filter(c => c.role !== 'minor');
    const minorChars = project.novel.characters.filter(c => c.role === 'minor');

    return (
      <div className="space-y-6">
        {/* 操作栏 */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">{t('drama.confirmCharHint')}</p>
          <div className="flex gap-3">
            {!batchCharImageRunning && mainChars.some(c => !c.confirmed) && (
              <button onClick={handleBatchCharImages} className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors">
                {t('drama.batchGenImages')}
              </button>
            )}
            {batchCharImageRunning && (
              <button onClick={() => { batchCharImageAbort.current = true; }} className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
                {t('drama.stopBatch')}
              </button>
            )}
            <button onClick={async () => { const data = await apiCall(`/api/drama/${projectId}/refresh-prompts`, 'POST'); if (data?.project) setProject(data.project); }}
              disabled={loading} className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-colors">
              {t('drama.refreshPrompts')}
            </button>
            <button onClick={async () => {
              const data = await apiCall(`/api/drama/${projectId}/repair-images`, 'POST');
              if (data) {
                const msg = `修复完成: ${data.repairedChars?.length || 0} 个角色, ${data.repairedLocs?.length || 0} 个场景`;
                console.log(msg, data);
                alert(msg);
                await refreshProject();
              }
            }} disabled={loading} className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-yellow-400 hover:text-yellow-300 text-sm transition-colors">
              {isZh ? '修复图片' : 'Repair Images'}
            </button>
            {/* 下载所有角色图 */}
            {mainChars.some(c => c.imageUrls.length > 0) && (
              <button onClick={() => downloadAllImages(mainChars.flatMap(c => c.imageUrls.map((url, i) => ({ url, name: `${c.newName}_${i + 1}.png` }))))}
                className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-2">
                ↓ {isZh ? '下载' : 'Download'}
              </button>
            )}
          </div>
        </div>

        {/* 角色卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {mainChars.map(char => {
            const progress = charImageProgress[char.id];
            const isGen = progress?.generating;
            const sel = selectedImages[char.id];
            return (
              <div key={char.id} className="bg-[#161616] rounded-2xl p-5 border border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <UserIcon className="w-5 h-5 text-green-400" />
                    <span className="text-base text-white font-medium">{char.newName}</span>
                    {char.originalName !== char.newName && <span className="text-xs text-gray-600">← {char.originalName}</span>}
                    <span className="text-xs text-gray-500 bg-[#0e0e0e] px-2 py-0.5 rounded">({char.role})</span>
                  </div>
                  {char.confirmed ? (
                    <span className="text-sm text-green-400 flex items-center gap-1.5"><CheckIcon className="w-4 h-4" />{t('drama.confirmed')}</span>
                  ) : (
                    <div className="flex gap-2">
                      {!isGen && <button onClick={() => handleGenerateCharImage(char.id)} className="px-3.5 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium">{t('drama.genImage')}</button>}
                      {char.imageUrls.length > 0 && !isGen && (
                        <button onClick={() => handleConfirmCharacter(char.id)} disabled={loading} className="px-3.5 py-2 rounded-xl bg-green-600/30 text-green-400 hover:bg-green-600/50 text-sm font-medium">{t('common.confirm')}{sel && sel.size > 0 ? ` (${sel.size})` : ''}</button>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-4">{char.visualPrompt || char.description}</p>
                {/* 参考图上传 */}
                {!char.confirmed && (
                  <div className="mb-4 flex items-center gap-3">
                    {char.refImageUrl ? (
                      <div className="relative group flex-shrink-0">
                        <img src={char.refImageUrl} alt="ref" className="w-20 h-24 object-cover rounded-lg border border-cyan-700/50" />
                        <button onClick={() => handleRemoveCharRefImage(char.id)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100"><CloseIcon className="w-3 h-3 text-white" /></button>
                      </div>
                    ) : (
                      <label className="flex-shrink-0 w-20 h-24 border-2 border-dashed border-white/10 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-green-500/50 transition-colors">
                        {charRefUploading[char.id] ? <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> : <><span className="text-gray-500 text-xl">+</span><span className="text-[10px] text-gray-600">{t('drama.uploadRef')}</span></>}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadCharRefImage(char.id, f); e.target.value = ''; }} />
                      </label>
                    )}
                  </div>
                )}
                {/* 生成进度 */}
                {isGen && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-green-400">{t('drama.genImageProgress', { done: progress.done, total: progress.total })}</span>
                    </div>
                    <div className="w-full bg-[#1a1a1a] rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                {/* 角色档案图片 */}
                {char.profileImages?.main ? (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      {/* 主图 */}
                      <div className="relative group flex-shrink-0">
                        <img src={char.profileImages.main} alt={`${char.newName} 主图`} loading="lazy"
                          className="w-28 h-36 object-cover rounded-xl border-2 border-green-500/50 cursor-pointer"
                          onClick={() => setPreviewImage(char.profileImages!.main!)} />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-green-600/80 rounded text-[9px] text-white font-medium">主图</span>
                      </div>
                      {/* 多角度/细节 */}
                      <div className="flex flex-wrap gap-2 flex-1">
                        {(['front', 'side', 'back', 'costume', 'props', 'expressions'] as const).map(type => {
                          const url = char.profileImages?.[type];
                          const labels: Record<string, string> = { front: '正面', side: '侧面', back: '背面', costume: '服装', props: '道具', expressions: '表情' };
                          if (!url) return null;
                          return (
                            <div key={type} className="relative group">
                              <img src={url} alt={`${char.newName} ${labels[type]}`} loading="lazy"
                                className="w-16 h-20 object-cover rounded-lg border border-white/10 cursor-pointer hover:border-white/30 transition-all"
                                onClick={() => setPreviewImage(url)} />
                              <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-gray-300 text-center py-0.5 rounded-b-lg">{labels[type]}</span>
                            </div>
                          );
                        })}
                        {char.profileImages?.custom?.map((item, i) => (
                          <div key={`custom-${i}`} className="relative group">
                            <img src={item.url} alt={item.label} loading="lazy"
                              className="w-16 h-20 object-cover rounded-lg border border-white/10 cursor-pointer hover:border-white/30 transition-all"
                              onClick={() => setPreviewImage(item.url)} />
                            <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-gray-300 text-center py-0.5 rounded-b-lg">{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* 主图候选折叠 */}
                    {char.imageUrls.length > 1 && (
                      <details className="border-t border-white/5 pt-2">
                        <summary className="text-[10px] text-gray-600 cursor-pointer hover:text-gray-400">主图候选 ({char.imageUrls.length}张)</summary>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {char.imageUrls.map((url, i) => (
                            <div key={i} className="relative group">
                              <img src={url} alt={`候选 ${i + 1}`} loading="lazy"
                                className={`w-14 h-18 object-cover rounded-lg border cursor-pointer ${url === char.profileImages?.main ? 'border-green-500' : 'border-white/10 hover:border-white/20'}`}
                                onClick={() => setPreviewImage(url)} />
                              {url === char.profileImages?.main && <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center"><CheckIcon className="w-2 h-2 text-white" /></div>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ) : char.imageUrls.length > 0 ? (
                  <div className="flex gap-3 flex-wrap">
                    {char.imageUrls.map((url, i) => {
                      const isSel = sel?.has(url);
                      return (
                        <div key={i} className="relative group">
                          <img src={url} alt={`${char.newName} ${i + 1}`} loading="lazy"
                            className={`w-24 h-28 object-cover rounded-xl border-2 cursor-pointer transition-all ${isSel ? 'border-green-500 ring-2 ring-green-500/30' : 'border-white/10 hover:border-white/20'}`}
                            onClick={() => !char.confirmed && toggleImageSelection(char.id, url)} />
                          {!char.confirmed && isSel && <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"><CheckIcon className="w-3 h-3 text-white" /></div>}
                          <button onClick={(e) => { e.stopPropagation(); setPreviewImage(url); }} className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-gray-300 opacity-0 group-hover:opacity-100">{t('drama.previewImage')}</button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {/* 档案生成状态 */}
                {char.profileStatus && char.profileStatus !== 'idle' && char.profileStatus !== 'done' && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-green-400">
                      {char.profileStatus === 'main_generating' && '生成主图候选...'}
                      {char.profileStatus === 'main_scoring' && 'AI评分选择最佳主图...'}
                      {char.profileStatus === 'detail_generating' && '生成多角度细节图...'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 龙套 */}
        {minorChars.length > 0 && (
          <details className="bg-[#161616] rounded-2xl border border-white/5">
            <summary className="px-5 py-4 text-sm text-gray-500 cursor-pointer">{t('drama.minorChars', { count: minorChars.length })}</summary>
            <div className="px-5 pb-4 space-y-2">
              {minorChars.map(c => (
                <div key={c.id} className="flex items-center gap-3 text-sm py-1.5">
                  <UserIcon className="w-4 h-4 text-gray-600" />
                  <span className="text-gray-400">{c.newName}</span>
                  {c.originalName !== c.newName && <span className="text-gray-700">← {c.originalName}</span>}
                  <span className="text-gray-600 truncate flex-1">{c.description}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* 生成脚本按钮 */}
        {allCharsConfirmed && !hasEpisodes && (
          <button onClick={handleGenerateScript} disabled={loading}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-base font-semibold transition-all flex items-center justify-center gap-3">
            <SparkleIcon className="w-5 h-5" />{loading ? t('common.loading') : t('drama.genScript')}
          </button>
        )}
        {loading && progressMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 bg-[#1a1a1a] rounded-2xl px-10 py-8 border border-white/10 shadow-2xl">
              <div className="w-10 h-10 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-300">{progressMsg}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==== Tab: 剧本 ====
  function renderScript() {
    if (!project) return null;

    if (!hasEpisodes && !loading) {
      return (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-5">
            <span className="text-3xl opacity-40">📄</span>
          </div>
          <p className="text-base text-gray-500 mb-3">{isZh ? '暂无分镜' : 'No storyboard yet'}</p>
          <p className="text-sm text-gray-600 mb-8">{isZh ? '使用 AI 从剧本生成分镜' : 'Use AI to generate storyboard from script'}</p>
          {allCharsConfirmed ? (
            <button onClick={handleGenerateScript} disabled={loading}
              className="px-8 py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-base font-semibold transition-all flex items-center gap-2.5">
              <SparkleIcon className="w-5 h-5" />{isZh ? '生成分镜' : 'Generate Storyboard'}
            </button>
          ) : (
            <p className="text-sm text-gray-600">{isZh ? '请先在「角色」页确认所有角色' : 'Please confirm all characters first'}</p>
          )}
        </div>
      );
    }

    if (loading && progressMsg) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          <div className="w-10 h-10 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-base text-gray-400">{progressMsg}</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* 操作栏 */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-gray-400">
            {t('drama.readySummary', { title: project.novel.title, episodes: project.episodes.length })}
          </div>
          <div className="flex gap-3 flex-wrap">
            {!optimizing && !generatingRefImages && !batchGenerating && (
              <>
                <button onClick={handleOptimizeScripts} className="px-4 py-2.5 rounded-xl bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors flex items-center gap-2 text-sm font-medium">
                  <SparkleIcon className="w-4 h-4" />{t('drama.optimizeScripts')}
                </button>
                <button onClick={handleGenerateRefImages} className="px-4 py-2.5 rounded-xl bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 transition-colors flex items-center gap-2 text-sm font-medium">
                  <SparkleIcon className="w-4 h-4" />{t('drama.genRefImages')}
                </button>
                <button onClick={handleBatchGenerate} disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white transition-colors flex items-center gap-2 text-sm font-medium">
                  <SparkleIcon className="w-4 h-4" />{project.episodes.some(e => e.videoStatus === 'done') ? t('drama.batchRetry') : t('drama.batchStart')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 进度条 */}
        {optimizing && <ProgressBar label={t('drama.optimizeInProgress')} detail={optimizeProgress} color="green" />}
        {generatingRefImages && <ProgressBar label={t('drama.refImageInProgress')} detail={refImageProgress} color="cyan" />}
        {batchGenerating && <ProgressBar label={t('drama.batchInProgress')} detail={batchProgress} color="green" />}

        {/* 集列表 */}
        <div className="space-y-4">
          {project.episodes.map(ep => (
            <EpisodeCard key={ep.number} ep={ep} project={project}
              editingEpisodes={editingEpisodes} setEditingEpisodes={setEditingEpisodes}
              optimizingEp={optimizingEp} regenRefEp={regenRefEp} regenShotsEp={regenShotsEp}
              onOptimize={() => handleOptimizeSingle(ep.number)}
              onRegenRef={() => handleRegenEpRefImages(ep.number)}
              onRegenShots={() => handleRegenShots(ep.number)}
              onSaveEpisode={async (epNum, text) => {
                const updated = project.episodes.map(e => e.number === epNum ? { ...e, prompt: text } : e);
                await apiCall(`/api/drama/${projectId}/update-episodes`, 'POST', { episodes: updated });
                await refreshProject();
                setEditingEpisodes(prev => { const n = { ...prev }; delete n[epNum]; return n; });
              }}
              onPreview={setPreviewImage}
              t={t}
            />
          ))}
        </div>

        {/* 完成统计 */}
        {project.episodes.some(e => e.videoStatus === 'done') && !batchGenerating && (
          <div className="text-center text-sm text-gray-500 py-2">
            {t('drama.batchStats', { done: project.episodes.filter(e => e.videoStatus === 'done').length, total: project.episodes.length })}
          </div>
        )}
      </div>
    );
  }

  // ==== Tab: 素材（场景+视频+音频） ====
  function renderMaterials() {
    if (!project) return null;
    // 场景图
    const sceneImages: { url: string; label: string; type: string }[] = [];
    project.novel.locations.forEach(l => { if (l.imageUrl) sceneImages.push({ url: l.imageUrl, label: l.newName, type: isZh ? '场景' : 'Location' }); });
    // 参考图
    project.episodes.forEach(ep => ep.refImageUrls?.forEach(url => sceneImages.push({ url, label: `E${ep.number}`, type: isZh ? '参考图' : 'Ref' })));
    // 视频
    const allVideos = project.episodes.filter(ep => ep.videoUrl && ep.videoStatus === 'done');

    const showImages = matFilter === 'all' || matFilter === 'images';
    const showVideos = matFilter === 'all' || matFilter === 'videos';

    return (
      <div className="space-y-6">
        {/* Filter + 上传下载 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(['all', 'images', 'videos'] as const).map(f => (
              <button key={f} onClick={() => setMatFilter(f)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${matFilter === f ? 'bg-white/10 text-white border border-white/10' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}>
                {f === 'all' ? `🗂 ${isZh ? '全部' : 'All'}` : f === 'images' ? `🖼 ${isZh ? '图片' : 'Images'} (${sceneImages.length})` : `🎬 ${isZh ? '视频' : 'Videos'} (${allVideos.length})`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-colors cursor-pointer flex items-center gap-2">
              ↑ {isZh ? '上传' : 'Upload'}
              <input type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={async (e) => {
                if (!e.target.files?.length) return;
                try {
                  await uploadMaterials(e.target.files);
                  await refreshProject();
                } catch (err) { setError((err as Error).message); }
                e.target.value = '';
              }} />
            </label>
            {(sceneImages.length > 0 || allVideos.length > 0) && (
              <button onClick={() => downloadAllImages(sceneImages.map(img => ({ url: img.url, name: `${img.label}.png` })))}
                className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-2">
                ↓ {isZh ? '下载' : 'Download'}
              </button>
            )}
          </div>
        </div>

        {/* 场景管理 */}
        {showImages && project.novel.locations.length > 0 && (
          <div className="bg-[#161616] rounded-2xl border border-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-white">{t('drama.locations')} ({project.novel.locations.length})</h4>
              <div className="flex gap-3">
                {!batchLocImageRunning && project.novel.locations.some(l => !l.imageUrl) && (
                  <button onClick={handleBatchLocImages} className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium">{t('drama.batchGenImages')}</button>
                )}
                {batchLocImageRunning && (
                  <button onClick={() => { batchLocImageAbort.current = true; }} className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium">{t('drama.stopBatch')}</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {project.novel.locations.map(loc => {
                const hasConfirmed = !!loc.imageUrl;
                const hasCandidates = !hasConfirmed && loc.imageUrls && loc.imageUrls.length > 0;
                const isExpanded = expandedLocId === loc.id;
                return (
                  <div key={loc.id} className="text-sm">
                    {hasConfirmed ? (
                      /* 已确认：显示单张 + hover 重新生成 */
                      <div className="relative group">
                        <img src={loc.imageUrl} alt={loc.newName} loading="lazy" className="w-full aspect-video object-cover rounded-xl border border-white/5 cursor-pointer" onClick={() => setPreviewImage(loc.imageUrl!)} />
                        <button onClick={() => handleGenerateLocImage(loc.id)} className="absolute inset-0 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white">{t('drama.regenImage')}</button>
                      </div>
                    ) : hasCandidates ? (
                      /* 有候选图：显示第一张缩略图 + 点击展开 */
                      <div>
                        <div className="relative cursor-pointer" onClick={() => setExpandedLocId(isExpanded ? null : loc.id)}>
                          <img src={loc.imageUrls![0]} alt={loc.newName} loading="lazy" className="w-full aspect-video object-cover rounded-xl border-2 border-green-500/50" />
                          <div className="absolute bottom-1 right-1 bg-black/70 text-green-400 text-[10px] px-1.5 py-0.5 rounded-md">{loc.imageUrls!.length} 张待选</div>
                        </div>
                        {isExpanded && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {loc.imageUrls!.map((url, idx) => (
                              <div key={idx} className="relative group/pick cursor-pointer" onClick={() => handleConfirmLocImage(loc.id, url)}>
                                <img src={url} alt={`${loc.newName}-${idx + 1}`} loading="lazy" className="w-full aspect-video object-cover rounded-lg border border-white/10 hover:border-green-500 transition-colors" />
                                <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover/pick:opacity-100 flex items-center justify-center text-xs text-white transition-opacity">✓ 选择</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* 无图：生成按钮或 loading */
                      <div className="w-full aspect-video bg-[#0e0e0e] rounded-xl border border-white/5 flex items-center justify-center">
                        {locImageGenerating[loc.id] ? <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> : (
                          <button onClick={() => handleGenerateLocImage(loc.id)} className="text-gray-500 hover:text-green-400 text-xs">{t('drama.genSceneImage')}</button>
                        )}
                      </div>
                    )}
                    <div className="mt-2 text-gray-300 truncate">{loc.newName}</div>
                    {loc.spatialRelation && (
                      <div className="text-[10px] text-gray-600 truncate">📍 {loc.spatialRelation}</div>
                    )}
                    {loc.variants && loc.variants.length > 0 && (
                      <div className="text-[10px] text-gray-600 truncate">🔄 {loc.variants.map((v: { label: string }) => v.label).join('、')}</div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 空间结构树 */}
            {project.novel.spatialMap?.tree && (
              <details className="mt-4 border-t border-white/5 pt-3">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                  🗺️ 空间结构
                </summary>
                <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap font-mono leading-relaxed">
                  {project.novel.spatialMap.tree}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* 参考图 */}
        {showImages && sceneImages.filter(i => i.type === (isZh ? '参考图' : 'Ref')).length > 0 && (
          <div className="bg-[#161616] rounded-2xl border border-white/5 p-5">
            <h4 className="text-sm font-semibold text-white mb-4">{isZh ? '参考图' : 'Reference Images'}</h4>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {sceneImages.filter(i => i.type === (isZh ? '参考图' : 'Ref')).map((img, i) => (
                <div key={i} className="group cursor-pointer" onClick={() => setPreviewImage(img.url)}>
                  <img src={img.url} alt={img.label} loading="lazy" className="w-full aspect-square object-cover rounded-xl border border-white/5 group-hover:border-white/20 transition-colors" />
                  <div className="mt-1.5 text-xs text-gray-500 truncate">{img.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sceneImages.length === 0 && allVideos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 bg-[#161616] rounded-2xl border border-dashed border-white/10">
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-5">
              <span className="text-3xl opacity-40">🖼</span>
            </div>
            <p className="text-base text-gray-500 font-medium">{isZh ? '暂无素材' : 'No materials yet'}</p>
            <p className="text-sm text-gray-600 mt-2">{isZh ? '场景和分镜生成的素材会显示在这里' : 'Materials from scenes and storyboards will appear here'}</p>
          </div>
        )}

        {/* Videos */}
        {showVideos && allVideos.length > 0 && (
          <div className="bg-[#161616] rounded-2xl border border-white/5 p-5">
            <h4 className="text-sm font-semibold text-white mb-4">{isZh ? '视频' : 'Videos'} ({allVideos.length})</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {allVideos.map(ep => (
                <a key={ep.number} href={`/api/video-proxy?url=${encodeURIComponent(ep.videoUrl!)}`} target="_blank" rel="noopener noreferrer"
                  className="bg-[#0e0e0e] rounded-xl border border-white/5 overflow-hidden hover:border-white/10 transition-colors">
                  <div className="aspect-video bg-black flex items-center justify-center text-3xl">▶</div>
                  <div className="p-3 text-sm">
                    <span className="text-green-400 font-medium">E{String(ep.number).padStart(2, '0')}</span>
                    <span className="text-gray-400 ml-2">{ep.title}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
}

// 进度条子组件
function ProgressBar({ label, detail, color }: { label: string; detail: string; color: 'green' | 'cyan' }) {
  const cls = color === 'cyan' ? 'border-cyan-500 border-t-transparent' : 'border-green-500 border-t-transparent';
  const textCls = color === 'cyan' ? 'text-cyan-400' : 'text-green-400';
  return (
    <div className="flex items-center gap-3 py-3 px-4 bg-[#111] rounded-xl border border-white/5">
      <div className={`w-4 h-4 border-2 rounded-full animate-spin ${cls}`} />
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-medium ${textCls}`}>{label}</span>
        {detail && <p className="text-[10px] text-gray-500 truncate mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

// 集卡片子组件
interface EpisodeCardProps {
  ep: import('../types/drama').EpisodeScript;
  project: import('../types/drama').DramaProject;
  editingEpisodes: Record<number, string>;
  setEditingEpisodes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  optimizingEp: Record<number, boolean>;
  regenRefEp: Record<number, boolean>;
  regenShotsEp: Record<number, boolean>;
  onOptimize: () => void;
  onRegenRef: () => void;
  onRegenShots: () => void;
  onSaveEpisode: (epNum: number, text: string) => Promise<void>;
  onPreview: (url: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function EpisodeCard({ ep, project, editingEpisodes, setEditingEpisodes, optimizingEp, regenRefEp, regenShotsEp, onOptimize, onRegenRef, onRegenShots, onSaveEpisode, onPreview, t }: EpisodeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const [showScript, setShowScript] = useState(false);

  const statusBorder = ep.videoStatus === 'done' ? 'border-green-500/30' :
    ep.videoStatus === 'generating' ? 'border-yellow-500/30' :
    ep.videoStatus === 'error' ? 'border-red-500/30' : 'border-white/5';

  const totalDuration = ep.shots?.length ? ep.shots[ep.shots.length - 1]?.endTime || 0 : 0;

  return (
    <div className={`bg-[#161616] rounded-2xl border transition-all ${statusBorder}`}>
      {/* 集头部 */}
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors rounded-t-2xl"
        onClick={() => setExpanded(!expanded)}>
        {/* 状态指示 */}
        <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[#0e0e0e]">
          {ep.videoStatus === 'done' && <CheckIcon className="w-4 h-4 text-green-400" />}
          {ep.videoStatus === 'generating' && <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />}
          {ep.videoStatus === 'error' && <span className="text-red-400 text-sm">✗</span>}
          {(!ep.videoStatus || ep.videoStatus === 'pending') && <span className="text-gray-600 text-sm">○</span>}
        </div>
        {/* 集号+标题 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-green-400 font-semibold text-sm">E{String(ep.number).padStart(2, '0')}</span>
            <span className="text-white font-medium text-sm truncate">{ep.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-600">{ep.act}</span>
            {ep.shots?.length > 0 && (
              <span className="text-xs text-gray-600">· {ep.shots.length} 个分镜 · {totalDuration}s</span>
            )}
          </div>
        </div>
        {/* 右侧操作 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {ep.score != null && (
            <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
              ep.score >= 8 ? 'bg-green-900/40 text-green-400' :
              ep.score >= 6 ? 'bg-yellow-900/40 text-yellow-400' :
              'bg-red-900/40 text-red-400'
            }`}>{ep.score}分</span>
          )}
          <button onClick={(e) => { e.stopPropagation(); onOptimize(); }} disabled={optimizingEp[ep.number]}
            className="px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium transition-colors disabled:opacity-50"
            title={t('drama.optimizeSingle')}>
            {optimizingEp[ep.number] ? <div className="w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" /> : '✦ 优化'}
          </button>
          {ep.videoStatus === 'done' && ep.videoUrl && (
            <a href={`/api/video-proxy?url=${encodeURIComponent(ep.videoUrl)}`} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 text-xs font-medium transition-colors">
              ▶ {t('drama.watchVideo')}
            </a>
          )}
          {ep.videoStatus === 'error' && ep.videoError && (
            <span className="text-xs text-red-400 truncate max-w-[150px]" title={ep.videoError}>{ep.videoError.substring(0, 30)}...</span>
          )}
          <svg className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
        </div>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/5">
          {/* 参考图区域 */}
          {(ep.refImageUrls?.length || 0) > 0 && (
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-cyan-400 font-medium">参考图</span>
                <button onClick={() => onRegenRef()} disabled={regenRefEp[ep.number]}
                  className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600/15 hover:bg-cyan-600/25 text-cyan-400 transition-colors disabled:opacity-50">
                  {regenRefEp[ep.number] ? <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin inline-block" /> : '🔄 重新生成'}
                </button>
              </div>
              <div className="flex gap-2.5 flex-wrap">
                {ep.refImageUrls?.map((url, ri) => (
                  <img key={ri} src={url} alt={`ref ${ri + 1}`} loading="lazy"
                    className="w-24 h-16 object-cover rounded-xl border border-white/10 cursor-pointer hover:border-cyan-500/50 hover:scale-105 transition-all"
                    onClick={() => onPreview(url)} />
                ))}
              </div>
            </div>
          )}
          {!ep.refImageUrls?.length && (
            <div className="pt-4 flex items-center justify-between">
              <span className="text-xs text-gray-600">暂无参考图</span>
              <button onClick={() => onRegenRef()} disabled={regenRefEp[ep.number]}
                className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600/15 hover:bg-cyan-600/25 text-cyan-400 transition-colors disabled:opacity-50">
                {regenRefEp[ep.number] ? <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin inline-block" /> : '✦ 生成参考图'}
              </button>
            </div>
          )}

          {/* 分镜时间轴 */}
          {ep.shots?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-400 font-medium">🎬 分镜</span>
                  <span className="text-[11px] text-gray-600">{ep.shots.length} 个 · {totalDuration}s</span>
                </div>
                <button onClick={() => onRegenShots()} disabled={regenShotsEp[ep.number]}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-600/15 hover:bg-green-600/25 text-green-400 transition-colors disabled:opacity-50">
                  {regenShotsEp[ep.number] ? <div className="w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin inline-block" /> : '🔄 重新生成'}
                </button>
              </div>
              {/* 时间轴分镜列表 */}
              <div className="relative">
                <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/[0.06]" />
                <div className="space-y-2.5">
                  {ep.shots.map((shot) => {
                    const isExpanded = expandedShot === shot.index;
                    const shotStatusColor = shot.videoStatus === 'done' ? 'bg-green-500' :
                      shot.videoStatus === 'generating' ? 'bg-yellow-500' :
                      shot.videoStatus === 'error' ? 'bg-red-500' : 'bg-gray-600';
                    return (
                      <div key={shot.index} className="relative pl-9">
                        <div className={`absolute left-[11px] top-3.5 w-[9px] h-[9px] rounded-full border-2 border-[#161616] ${shotStatusColor} z-10`} />
                        <div className={`bg-[#111] rounded-xl border transition-all ${
                          isExpanded ? 'border-white/10' : 'border-white/[0.04] hover:border-white/10'
                        }`}>
                          {/* 分镜摘要行 */}
                          <div className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer select-none"
                            onClick={() => setExpandedShot(isExpanded ? null : shot.index)}>
                            <span className="text-green-400 font-mono text-xs font-semibold flex-shrink-0">
                              S{String(shot.index).padStart(2, '0')}
                            </span>
                            <span className="text-[11px] text-gray-500 flex-shrink-0 tabular-nums">
                              {shot.startTime}s – {shot.endTime}s
                            </span>
                            {shot.transition && (
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-yellow-900/20 text-yellow-500/80 flex-shrink-0">
                                → {shot.transition}
                              </span>
                            )}
                            {shot.videoStatus === 'done' && <span className="text-green-400 text-xs">✓</span>}
                            {shot.videoStatus === 'generating' && <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                            {shot.videoStatus === 'error' && <span className="text-red-400 text-xs">✗</span>}
                            <span className="text-[11px] text-gray-600 ml-auto truncate max-w-[200px]">
                              {shot.prompt.split('\n')[0]}
                            </span>
                            <svg className={`w-3.5 h-3.5 text-gray-600 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
                          </div>
                          {/* 分镜详情 */}
                          {isExpanded && (
                            <div className="px-3.5 pb-3.5 border-t border-white/5 space-y-3 pt-3">
                              {/* 标签行：角色+场景 */}
                              <div className="flex flex-wrap gap-1.5">
                                {shot.characterRefs?.map(cid => {
                                  const char = project.novel?.characters?.find(c => c.id === cid);
                                  return (
                                    <span key={cid} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-900/25 text-blue-300 text-[11px]">
                                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                      {char?.newName || cid}
                                    </span>
                                  );
                                })}
                                {shot.locationRefs?.map(lid => {
                                  const loc = project.novel?.locations?.find(l => l.id === lid);
                                  return (
                                    <span key={lid} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-900/25 text-emerald-300 text-[11px]">
                                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                                      {loc?.newName || lid}
                                    </span>
                                  );
                                })}
                              </div>
                              {/* 结构化信息网格 */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {shot.cameraAngle && (
                                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#0e0e0e]">
                                    <span className="text-cyan-500 text-[11px] flex-shrink-0">🎥 镜头</span>
                                    <span className="text-[11px] text-gray-300">{shot.cameraAngle}</span>
                                  </div>
                                )}
                                {shot.action && (
                                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#0e0e0e]">
                                    <span className="text-gray-500 text-[11px] flex-shrink-0">🎬 动作</span>
                                    <span className="text-[11px] text-gray-300">{shot.action}</span>
                                  </div>
                                )}
                                {shot.dialogue && (
                                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#0e0e0e]">
                                    <span className="text-yellow-500 text-[11px] flex-shrink-0">💬 对白</span>
                                    <span className="text-[11px] text-yellow-200/70">{shot.dialogue}</span>
                                  </div>
                                )}
                                {shot.soundDesign && (
                                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#0e0e0e]">
                                    <span className="text-purple-400 text-[11px] flex-shrink-0">🔊 声音</span>
                                    <span className="text-[11px] text-purple-300/70">{shot.soundDesign}</span>
                                  </div>
                                )}
                              </div>
                              {/* 完整提示词 */}
                              <div className="bg-[#0e0e0e] rounded-lg p-3">
                                <div className="text-[10px] text-gray-600 mb-1.5">完整提示词</div>
                                <pre className="text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto custom-scrollbar">{shot.prompt}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 脚本编辑折叠 */}
          <div>
            <button onClick={() => setShowScript(!showScript)}
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1">
              <svg className={`w-3.5 h-3.5 transition-transform ${showScript ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
              {showScript ? '收起脚本' : '编辑脚本'}
            </button>
            {showScript && (
              <div className="mt-2">
                <textarea value={editingEpisodes[ep.number] ?? ep.prompt}
                  onChange={(e) => setEditingEpisodes(prev => ({ ...prev, [ep.number]: e.target.value }))}
                  className="w-full bg-[#0e0e0e] border border-white/10 rounded-xl px-4 py-3 text-xs text-gray-300 outline-none focus:border-green-500/30 min-h-[150px] resize-y font-mono leading-relaxed transition-colors" />
                {editingEpisodes[ep.number] !== undefined && editingEpisodes[ep.number] !== ep.prompt && (
                  <div className="flex gap-2.5 mt-2.5">
                    <button onClick={() => onSaveEpisode(ep.number, editingEpisodes[ep.number])}
                      className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors">{t('common.save')}</button>
                    <button onClick={() => setEditingEpisodes(prev => { const n = { ...prev }; delete n[ep.number]; return n; })}
                      className="px-4 py-2 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-xs transition-colors">{t('common.cancel')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
