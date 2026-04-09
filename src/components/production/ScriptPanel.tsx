// 脚本面板：上传/预览/清洗/AI解析
import { useState, useRef, useEffect } from 'react';
import * as api from '../../services/productionService';
import { useProductionTask } from '../../hooks/useProductionTask';

interface Props {
  projectId: string;
  episodes: Array<Record<string, unknown>>;
  onRefresh: () => void;
}

export default function ScriptPanel({ projectId, episodes, onRefresh }: Props) {
  const [uploading, setUploading] = useState(false);
  const [selectedEp, setSelectedEp] = useState(0);
  const [errMsg, setErrMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cleanTaskId, setCleanTaskId] = useState<string | null>(null);
  const [extractTaskId, setExtractTaskId] = useState<string | null>(null);

  const { progress: cleanProgress } = useProductionTask(cleanTaskId, onRefresh);
  const { progress: extractProgress } = useProductionTask(extractTaskId, onRefresh);

  const cleaning = cleanProgress?.status === 'running';
  const extracting = extractProgress?.status === 'running';
  const statusMsg = cleaning ? cleanProgress?.progress : extracting ? extractProgress?.progress : '';

  // 重新进入面板时恢复进行中的任务
  useEffect(() => {
    api.getProjectTasks(projectId).then(res => {
      for (const t of res.tasks || []) {
        if (t.status !== 'running') continue;
        if (t.stage === 'clean') setCleanTaskId(t.taskId);
        if (t.stage === 'extract') setExtractTaskId(t.taskId);
      }
    }).catch(() => {});
  }, [projectId]);

  const hasEpisodes = episodes.length > 0;
  const currentEp = episodes[selectedEp] as Record<string, unknown> | undefined;
  const shots = (currentEp?.shots as Array<Record<string, unknown>>) || [];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setErrMsg('');
    try {
      const res = await api.uploadScripts(projectId, files);
      if (res.error) { setErrMsg(`上传失败: ${res.error}`); }
      else { onRefresh(); }
    } catch (err) { setErrMsg(`上传异常: ${err}`); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClean = async () => {
    setErrMsg('');
    try {
      const res = await api.cleanScripts(projectId, true);
      if (res.error) { setErrMsg(`清洗启动失败: ${res.error}`); return; }
      if (res.taskId) setCleanTaskId(res.taskId);
    } catch (err) {
      setErrMsg(`清洗请求异常: ${err}`);
    }
  };

  const handleExtract = async () => {
    setErrMsg('');
    try {
      const res = await api.extractAssets(projectId);
      if (res.error) { setErrMsg(`提取启动失败: ${res.error}`); return; }
      if (res.taskId) setExtractTaskId(res.taskId);
    } catch (err) {
      setErrMsg(`提取异常: ${err}`);
    }
  };

  const handleStop = async (stage: string) => {
    await api.stopProjectTask(projectId, stage);
  };

  return (
    <div className="h-full flex">
      {/* Left: Episode List */}
      <div className="w-52 border-r border-white/5 flex flex-col">
        <div className="p-3 border-b border-white/5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.txt"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-all"
          >
            {uploading ? (
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />上传中...</span>
            ) : (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>上传脚本</>
            )}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {episodes.map((ep, idx) => (
            <button
              key={ep.id as string}
              onClick={() => setSelectedEp(idx)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                selectedEp === idx ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <span className="font-medium">第{ep.episodeNumber as number}集</span>
              <span className="ml-2 text-[10px] opacity-60">
                {ep.status === 'raw' ? '待清洗' : ep.status === 'cleaned' ? '已清洗' : (ep.status as string)}
              </span>
            </button>
          ))}
          {!hasEpisodes && (
            <div className="text-center py-8 text-gray-600 text-xs">请上传分镜脚本</div>
          )}
        </div>
        {hasEpisodes && (
          <div className="p-3 border-t border-white/5 space-y-2">
            {cleaning ? (
              <button
                onClick={() => handleStop('clean')}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-red-600/20 border border-red-500/20 text-red-400 hover:bg-red-600/30 transition-all"
              >
                停止清洗
              </button>
            ) : (
              <button
                onClick={handleClean}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-blue-600/20 border border-blue-500/20 text-blue-400 hover:bg-blue-600/30 transition-all"
              >
                AI 脚本清洗
              </button>
            )}
            {extracting ? (
              <button
                onClick={() => handleStop('extract')}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-red-600/20 border border-red-500/20 text-red-400 hover:bg-red-600/30 transition-all"
              >
                停止提取
              </button>
            ) : (
              <button
                onClick={handleExtract}
                disabled={cleaning}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-purple-600/20 border border-purple-500/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-50 transition-all"
              >
                提取资产
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right: Shot Preview */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* 状态/错误提示 */}
        {(errMsg || cleanProgress?.status === 'error' || extractProgress?.status === 'error') && (
          <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            <span className="break-all">{errMsg || cleanProgress?.error || extractProgress?.error}</span>
            <button onClick={() => setErrMsg('')} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
          </div>
        )}
        {statusMsg && cleanProgress?.status !== 'error' && extractProgress?.status !== 'error' && !errMsg && (
          <div className="mb-3 px-4 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs flex items-center gap-2">
            {(cleaning || extracting) && <span className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin shrink-0" />}
            {statusMsg}
            {cleanProgress?.elapsed ? <span className="ml-auto text-blue-400/40">{cleanProgress.elapsed}s</span> : null}
          </div>
        )}
        {cleanProgress?.status === 'done' && !errMsg && (
          <div className="mb-3 px-4 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            {cleanProgress.progress}
          </div>
        )}
        {shots.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">第{currentEp?.episodeNumber as number}集 - {shots.length}个镜头</h3>
              <span className="text-xs text-gray-500">
                总时长: {shots.reduce((s, sh) => s + ((sh.duration as number) || 0), 0)}秒
              </span>
            </div>
            {shots.map((shot, idx) => (
              <div key={idx} className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded text-gray-300">#{shot.index as number || idx + 1}</span>
                  <span className="text-[10px] text-gray-500">{shot.scene as string}</span>
                  <span className="text-[10px] text-green-400 ml-auto">{shot.duration as number}s</span>
                </div>
                <p className="text-xs text-gray-300 mb-2">{shot.content as string}</p>
                {(shot.dialogue as string) && (
                  <p className="text-xs text-yellow-400/80 italic pl-3 border-l-2 border-yellow-500/30">
                    {shot.dialogue as string}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
                  {(shot.cameraWork as string) && <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{shot.cameraWork as string}</span>}
                  {(shot.soundDesign as string) && <span className="bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded">{shot.soundDesign as string}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : currentEp?.rawScript ? (
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">原始脚本文本</h3>
            <pre className="text-xs text-gray-400 whitespace-pre-wrap bg-[#1a1a1a] p-4 rounded-xl border border-white/5 max-h-[600px] overflow-y-auto">
              {(currentEp.rawScript as string).slice(0, 5000)}
              {(currentEp.rawScript as string).length > 5000 && '\n\n... (已截断)'}
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            选择一集查看分镜详情
          </div>
        )}
      </div>
    </div>
  );
}
