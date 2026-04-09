// 时间线面板：分段视图层级（集 → 段落 → 镜头）+ 音乐管理 + Suno 配置 + 视频生成
import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../../services/productionService';
import { useProductionTask } from '../../hooks/useProductionTask';

interface Props {
  projectId: string;
  sessionId: string;
  episodes: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  onRefresh: () => void;
}

interface SegmentData {
  id: string;
  episodeId: string;
  segmentIndex: number;
  shotIds: number[];
  totalDuration: number;
  mergedPrompt: string;
  transitionHint: string;
  videoUrl: string;
  musicUrl: string;
  composedUrl: string;
  videoStatus: string;
  musicStatus: string;
}

type ViewMode = 'segments' | 'shots';

export default function TimelinePanel({ projectId, sessionId, episodes, assets, onRefresh: _onRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('segments');
  const [selectedEp, setSelectedEp] = useState(0);
  const [segments, setSegments] = useState<SegmentData[]>([]);
  const [building, setBuilding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showSunoConfig, setShowSunoConfig] = useState(false);
  const [sunoApiKey, setSunoApiKey] = useState('');
  const [sunoConfigured, setSunoConfigured] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [musicTaskId, setMusicTaskId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeTaskId, setComposeTaskId] = useState<string | null>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const [uploadingSegId, setUploadingSegId] = useState<string | null>(null);

  const characterAssets = assets.filter(a => a.assetType === 'character');
  const currentEp = episodes[selectedEp] as Record<string, unknown> | undefined;
  const shots = (currentEp?.shots as Array<Record<string, unknown>>) || [];

  const loadSegments = useCallback(async () => {
    try {
      const result = await api.getSegments(projectId);
      if (result?.segments) setSegments(result.segments);
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { loadSegments(); }, [loadSegments]);

  useEffect(() => {
    api.getMusicConfig().then(data => {
      if (data?.configured) setSunoConfigured(true);
    }).catch(() => {});
  }, []);

  const { progress: musicProgress } = useProductionTask(musicTaskId, () => {
    setMusicTaskId(null);
    loadSegments();
  });

  const { progress: composeProgress } = useProductionTask(composeTaskId, () => {
    setComposeTaskId(null);
    setComposing(false);
    loadSegments();
  });

  const handleBuildSegments = async () => {
    setBuilding(true);
    setErrMsg('');
    try {
      const result = await api.buildSegments(projectId);
      if (result?.segments) {
        await loadSegments();
      }
    } catch (e) { setErrMsg(String(e)); }
    setBuilding(false);
  };

  const handleGenerateVideos = async () => {
    if (!sessionId) { setErrMsg('请先在设置中配置 Session ID'); return; }
    setGenerating(true);
    try {
      await api.generateVideos(projectId, sessionId);
    } catch (e) { setErrMsg(String(e)); }
    setGenerating(false);
  };

  const handleGenerateMusic = async () => {
    setErrMsg('');
    try {
      const result = await api.generateMusic(projectId);
      if (result?.taskId) setMusicTaskId(result.taskId);
    } catch (e) { setErrMsg(String(e)); }
  };

  const handleSaveSunoConfig = async () => {
    setErrMsg('');
    try {
      await api.configureSuno(sunoApiKey);
      setSunoConfigured(true);
      setShowSunoConfig(false);
      setSunoApiKey('');
    } catch (e) { setErrMsg(String(e)); }
  };

  const handleUploadMusic = async (segId: string, file: File) => {
    setUploadingSegId(segId);
    try {
      await api.uploadSegmentMusic(projectId, segId, file);
      await loadSegments();
    } catch (e) { setErrMsg(String(e)); }
    setUploadingSegId(null);
  };

  const handleCompose = async () => {
    setErrMsg('');
    setComposing(true);
    try {
      const result = await api.composeProject(projectId);
      if (result?.taskId) setComposeTaskId(result.taskId);
    } catch (e) {
      setErrMsg(String(e));
      setComposing(false);
    }
  };

  const composedSegments = segments.filter(s => s.composedUrl);
  const canCompose = segments.some(s => s.videoStatus === 'done');

  const getCharName = (charId: string) => {
    const char = characterAssets.find(a => (a.id as string) === charId);
    return (char?.name as string) || charId.slice(0, 8);
  };

  const epSegments = currentEp ? segments.filter(s => s.episodeId === (currentEp.id as string)) : [];
  const totalSegments = segments.length;
  const doneSegments = segments.filter(s => s.videoStatus === 'done').length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">生成时间线</h3>
          {/* View Toggle */}
          <div className="flex bg-white/5 rounded-lg p-0.5">
            {(['segments', 'shots'] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  viewMode === m ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {m === 'segments' ? '段落视图' : '镜头视图'}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">
            {viewMode === 'segments' ? `${doneSegments}/${totalSegments} 段完成` : `${episodes.reduce((s, e) => s + ((e.shots as unknown[]) || []).length, 0)} 镜头`}
          </span>
          {totalSegments > 0 && (
            <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${totalSegments > 0 ? (doneSegments / totalSegments) * 100 : 0}%` }} />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleBuildSegments}
            disabled={building || episodes.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-50 transition-all"
          >
            {building ? '分段中...' : '智能分段'}
          </button>
          <button
            onClick={() => setShowSunoConfig(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              sunoConfigured ? 'bg-green-600/20 border border-green-500/20 text-green-400' : 'bg-yellow-600/20 border border-yellow-500/20 text-yellow-400'
            }`}
          >
            {sunoConfigured ? 'Suno已配置' : '配置Suno'}
          </button>
          <button
            onClick={handleGenerateMusic}
            disabled={!sunoConfigured || segments.length === 0 || !!musicTaskId}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600/20 border border-purple-500/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-50 transition-all"
          >
            {musicTaskId ? '生成中...' : '生成音乐'}
          </button>
          <button
            onClick={handleGenerateVideos}
            disabled={generating || episodes.length === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-all"
          >
            {generating ? '生成中...' : '批量生成视频'}
          </button>
          <button
            onClick={handleCompose}
            disabled={composing || !canCompose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 transition-all"
          >
            {composing ? '合成中...' : `合成导出${composedSegments.length > 0 ? ` (${composedSegments.length}段)` : ''}`}
          </button>
        </div>
      </div>

      {errMsg && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {errMsg}
          <button onClick={() => setErrMsg('')} className="ml-2 text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}

      {musicProgress && musicProgress.status === 'running' && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          {musicProgress.progress}
        </div>
      )}

      {composeProgress && composeProgress.status === 'running' && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          FFmpeg 合成: {composeProgress.progress}
        </div>
      )}

      {composeProgress && composeProgress.status === 'done' && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
          合成完成: {composeProgress.progress}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Episode Selector */}
        <div className="w-40 border-r border-white/5 overflow-y-auto py-1">
          {episodes.map((ep, idx) => {
            const epSegs = segments.filter(s => s.episodeId === (ep.id as string));
            const doneSeg = epSegs.filter(s => s.videoStatus === 'done').length;
            const composedSeg = epSegs.filter(s => s.composedUrl).length;
            const epComposed = !!(ep.composedUrl as string);
            return (
              <button
                key={ep.id as string}
                onClick={() => setSelectedEp(idx)}
                className={`w-full text-left px-3 py-2.5 text-xs transition-colors ${
                  selectedEp === idx ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    第{ep.episodeNumber as number}集
                    {epComposed && <span className="text-[9px] text-amber-400">✓</span>}
                  </span>
                  <span className="text-[10px] text-gray-600">{doneSeg}/{epSegs.length}段</span>
                </div>
                <div className="w-full h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: epSegs.length > 0 ? `${(doneSeg / epSegs.length) * 100}%` : '0%' }} />
                </div>
                {composedSeg > 0 && (
                  <div className="w-full h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(composedSeg / epSegs.length) * 100}%` }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {viewMode === 'segments' ? (
            epSegments.length > 0 ? (
              <div className="space-y-4">
                {epSegments.map(seg => (
                  <div key={seg.id} className="bg-[#1a1a1a] border border-white/5 rounded-xl overflow-hidden">

                    {/* Segment Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 text-xs font-bold">
                          {seg.segmentIndex + 1}
                        </div>
                        <div>
                          <div className="text-xs text-white font-medium">段落 {seg.segmentIndex + 1}</div>
                          <div className="text-[10px] text-gray-500">
                            {seg.shotIds.length}个镜头 &middot; {seg.totalDuration}s &middot; {seg.transitionHint}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Video Status */}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          seg.videoStatus === 'done' ? 'bg-green-500/10 text-green-400' :
                          seg.videoStatus === 'generating' ? 'bg-blue-500/10 text-blue-400' :
                          seg.videoStatus === 'error' ? 'bg-red-500/10 text-red-400' :
                          'bg-white/5 text-gray-500'
                        }`}>
                          {seg.videoStatus === 'done' ? '视频完成' : seg.videoStatus === 'generating' ? '生成中' : seg.videoStatus === 'error' ? '失败' : '待生成'}
                        </span>
                        {/* Music Status */}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          seg.musicStatus === 'done' ? 'bg-purple-500/10 text-purple-400' : 'bg-white/5 text-gray-500'
                        }`}>
                          {seg.musicUrl ? '有音乐' : '无音乐'}
                        </span>
                        {/* Upload Music */}
                        <button
                          onClick={() => { setUploadingSegId(seg.id); musicFileRef.current?.click(); }}
                          disabled={uploadingSegId === seg.id}
                          className="px-2 py-1 rounded text-[10px] bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                        >
                          {uploadingSegId === seg.id ? '上传中...' : '上传BGM'}
                        </button>
                      </div>
                    </div>
                    {/* Segment Body: Video + Prompt */}
                    <div className="p-4 flex gap-4">
                      <div className="flex flex-col gap-2">
                        {seg.composedUrl ? (
                          <div className="relative">
                            <video src={seg.composedUrl} className="w-40 h-72 rounded-lg object-cover bg-black" controls />
                            <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-amber-600/80 text-[9px] text-white font-medium">
                              合成版
                            </div>
                          </div>
                        ) : seg.videoUrl ? (
                          <video src={seg.videoUrl} className="w-40 h-72 rounded-lg object-cover bg-black" controls muted />
                        ) : (
                          <div className="w-40 h-72 rounded-lg bg-[#111] flex items-center justify-center text-gray-600 text-xs">
                            {seg.videoStatus === 'generating' ? (
                              <div className="w-5 h-5 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                            ) : '待生成'}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-gray-500 mb-1">合并 Prompt</div>
                        <p className="text-xs text-gray-300 mb-3 line-clamp-4">{seg.mergedPrompt}</p>
                        {seg.musicUrl && (
                          <div className="mb-2">
                            <div className="text-[10px] text-gray-500 mb-1">BGM</div>
                            <audio src={seg.musicUrl} controls className="h-8 w-full" />
                          </div>
                        )}
                        <div className="text-[10px] text-gray-600 mt-2">镜头: [{seg.shotIds.join(', ')}]</div>
                        {seg.composedUrl && (
                          <div className="mt-2 text-[10px] text-amber-400 flex items-center gap-1">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" /></svg>
                            已合成（视频+配音+BGM）
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {currentEp && (currentEp.composedUrl as string) ? (
                  <div className="mt-6 p-4 bg-[#1a1a1a] border border-amber-500/20 rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" /></svg>
                      </div>
                      <div>
                        <div className="text-xs text-white font-medium">第{(currentEp.episodeNumber as number)}集 完整合成视频</div>
                        <div className="text-[10px] text-gray-500">{epSegments.length}个段落合成</div>
                      </div>
                      <a
                        href={currentEp.composedUrl as string}
                        download
                        className="ml-auto px-3 py-1.5 rounded-lg text-[10px] font-medium bg-amber-600/20 border border-amber-500/20 text-amber-400 hover:bg-amber-600/30"
                      >
                        下载视频
                      </a>
                    </div>
                    <video
                      src={currentEp.composedUrl as string}
                      className="w-full max-h-[500px] rounded-lg bg-black"
                      controls
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-3">
                <p>暂无分段数据</p>
                <button
                  onClick={handleBuildSegments}
                  disabled={building}
                  className="px-4 py-2 rounded-lg text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30"
                >
                  {building ? '处理中...' : '点击执行智能分段'}
                </button>
              </div>
            )
          ) : (
            /* Shots View (legacy) */
            shots.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {shots.map((shot, idx) => {
                  const status = shot.videoStatus as string;
                  const charRefs = (shot.characterRefs as string[]) || [];
                  return (
                    <div key={idx} className="bg-[#1a1a1a] border border-white/5 rounded-xl overflow-hidden">
                      <div className="aspect-[9/16] bg-[#111] relative flex items-center justify-center">
                        {status === 'done' && (shot.videoUrl as string) ? (
                          <video src={shot.videoUrl as string} className="w-full h-full object-cover" controls muted />
                        ) : status === 'generating' ? (
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                            <span className="text-[10px] text-green-400">生成中</span>
                          </div>
                        ) : status === 'error' ? (
                          <div className="flex flex-col items-center gap-1 text-red-400">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
                            <span className="text-[10px]">失败</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-600">待生成</span>
                        )}
                        <div className="absolute top-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-gray-300">
                          #{(shot.index as number) || idx + 1}
                        </div>
                        <div className="absolute top-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-green-400">
                          {shot.duration as number}s
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-gray-400 line-clamp-2">{shot.content as string}</p>
                        {charRefs.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {charRefs.map(id => (
                              <span key={id} className="text-[9px] bg-orange-500/10 text-orange-400 px-1 py-0.5 rounded">
                                {getCharName(id)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                选择一集查看镜头
              </div>
            )
          )}
        </div>
      </div>

      {/* Hidden Music File Input */}
      <input
        ref={musicFileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadingSegId) handleUploadMusic(uploadingSegId, file);
          e.target.value = '';
        }}
      />

      {/* Suno Config Modal */}
      {showSunoConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowSunoConfig(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">配置 Suno AI 音乐</h2>
            {sunoConfigured && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/10 text-[11px] text-green-400">
                已配置
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Suno API Key</label>
                <input
                  value={sunoApiKey}
                  onChange={e => setSunoApiKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white"
                  placeholder="sk-..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowSunoConfig(false)} className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white">取消</button>
              <button
                onClick={handleSaveSunoConfig}
                disabled={!sunoApiKey}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
