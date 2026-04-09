// 资产管理面板：人物/场景/道具卡片 + 三视图生成 + 参考图上传 + 大图预览
import { useState, useRef, useCallback } from 'react';
import * as api from '../../services/productionService';
import { useProductionTask, type TaskProgress } from '../../hooks/useProductionTask';

interface Props {
  projectId: string;
  assets: Array<Record<string, unknown>>;
  onRefresh: () => void;
  sessionId?: string;
}

type Tab = 'character' | 'location' | 'prop';

const TAB_CONFIG: { key: Tab; label: string; color: string }[] = [
  { key: 'character', label: '角色', color: 'text-orange-400' },
  { key: 'location', label: '场景', color: 'text-blue-400' },
  { key: 'prop', label: '道具', color: 'text-purple-400' },
];

function ImagePreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <img src={url} alt="preview" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl" />
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/10 backdrop-blur text-white flex items-center justify-center hover:bg-white/20"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

function AssetImageGenProgress({ taskId, onComplete }: { taskId: string | null; onComplete: () => void }) {
  const { progress } = useProductionTask(taskId, onComplete);
  if (!taskId || !progress) return null;
  const isRunning = progress.status === 'running';
  const isDone = progress.status === 'done';
  const isError = progress.status === 'error';

  return (
    <div className={`mt-2 px-2 py-1.5 rounded-lg text-[11px] ${
      isRunning ? 'bg-blue-500/10 text-blue-400' :
      isDone ? 'bg-green-500/10 text-green-400' :
      isError ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-gray-400'
    }`}>
      {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse mr-1.5" />}
      {progress.progress || (progress as TaskProgress).error || '处理中...'}
    </div>
  );
}

export default function AssetPanel({ projectId, assets, onRefresh, sessionId }: Props) {
  const [tab, setTab] = useState<Tab>('character');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [genTaskIds, setGenTaskIds] = useState<Record<string, string>>({});
  const [errMsg, setErrMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const filtered = assets.filter(a => a.assetType === tab);

  const handleConfirmAll = async () => {
    setConfirming(true);
    try {
      await api.confirmAssets(projectId);
      onRefresh();
    } catch (e) { setErrMsg(String(e)); }
    setConfirming(false);
  };

  const handleSave = async (assetId: string) => {
    try {
      await api.updateAsset(assetId, editFields);
      setEditingId(null);
      setEditFields({});
      onRefresh();
    } catch (e) { setErrMsg(String(e)); }
  };

  const handleDelete = async (assetId: string) => {
    if (!confirm('确定删除此资产？')) return;
    await api.deleteAsset(assetId);
    onRefresh();
  };

  const handleGenerateImages = useCallback(async (assetId: string) => {
    if (!sessionId) {
      setErrMsg('需要先在设置中配置 Session ID');
      return;
    }
    setErrMsg('');
    try {
      const result = await api.generateAssetImages(assetId, sessionId);
      if (result.taskId) {
        setGenTaskIds(prev => ({ ...prev, [assetId]: result.taskId }));
      }
    } catch (e) { setErrMsg(String(e)); }
  }, [sessionId]);

  const handleUploadImage = useCallback(async (assetId: string, file: File) => {
    setUploadingId(assetId);
    setErrMsg('');
    try {
      await api.uploadAssetImage(assetId, file);
      onRefresh();
    } catch (e) { setErrMsg(String(e)); }
    setUploadingId(null);
  }, [onRefresh]);

  const handleFileChange = (assetId: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUploadImage(assetId, file);
    e.target.value = '';
  };

  return (
    <div className="h-full flex flex-col">
      {previewUrl && <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />}

      {/* Tab + Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex gap-1">
          {TAB_CONFIG.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === t.key ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {t.label} ({assets.filter(a => a.assetType === t.key).length})
            </button>
          ))}
        </div>
        <button
          onClick={handleConfirmAll}
          disabled={confirming || assets.length === 0}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-green-600/20 border border-green-500/20 text-green-400 hover:bg-green-600/30 disabled:opacity-50 transition-all"
        >
          {confirming ? '确认中...' : '确认全部资产'}
        </button>
      </div>

      {errMsg && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
          {errMsg}
          <button onClick={() => setErrMsg('')} className="ml-auto text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}

      {/* Asset Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(asset => {
              const assetId = asset.id as string;
              const isEditing = editingId === assetId;
              const metadata = asset.metadata as Record<string, unknown>;
              const imageUrls = (asset.imageUrls as string[]) || [];
              const profileImages = (asset.profileImages as Record<string, string>) || {};
              const hasProfileImages = Object.keys(profileImages).length > 0;
              const genTaskId = genTaskIds[assetId] || null;

              return (
                <div key={assetId} className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {imageUrls.length > 0 ? (
                        <img
                          src={imageUrls[0]}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover cursor-pointer hover:ring-2 ring-white/20"
                          onClick={() => setPreviewUrl(imageUrls[0])}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-gray-600 text-xs">
                          {(asset.name as string)?.[0]}
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-semibold text-white">{asset.name as string}</h4>
                        <span className={`text-[10px] ${
                          asset.status === 'confirmed' ? 'text-green-400' :
                          asset.status === 'images_ready' ? 'text-blue-400' :
                          'text-gray-500'
                        }`}>
                          {asset.status === 'confirmed' ? '已确认' : asset.status === 'images_ready' ? '图片就绪' : '待确认'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          if (isEditing) { handleSave(assetId); } else {
                            setEditingId(assetId);
                            setEditFields({ name: asset.name as string, description: asset.description as string, visualPrompt: asset.visualPrompt as string });
                          }
                        }}
                        className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          {isEditing ? <path d="M5 13l4 4L19 7" /> : <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />}
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(assetId)}
                        className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Edit / Display */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        value={editFields.name || ''}
                        onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                        placeholder="名称"
                      />
                      <textarea
                        value={editFields.description || ''}
                        onChange={e => setEditFields(f => ({ ...f, description: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white h-16 resize-none"
                        placeholder="描述"
                      />
                      <textarea
                        value={editFields.visualPrompt || ''}
                        onChange={e => setEditFields(f => ({ ...f, visualPrompt: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white h-16 resize-none"
                        placeholder="Visual Prompt"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400 mb-2 line-clamp-2">{asset.description as string}</p>
                      {tab === 'character' && metadata && (
                        <div className="flex flex-wrap gap-1.5 text-[10px]">
                          {metadata.gender ? <span className="bg-pink-500/10 text-pink-400 px-1.5 py-0.5 rounded">{String(metadata.gender)}</span> : null}
                          {metadata.age ? <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{String(metadata.age)}</span> : null}
                          {metadata.hair ? <span className="bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded">{String(metadata.hair).slice(0, 15)}</span> : null}
                        </div>
                      )}
                      {tab === 'location' && metadata && (
                        <div className="flex flex-wrap gap-1.5 text-[10px]">
                          <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{metadata.interior ? '内景' : '外景'}</span>
                          {metadata.timeOfDay ? <span className="bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded">{String(metadata.timeOfDay)}</span> : null}
                        </div>
                      )}
                    </>
                  )}

                  {/* Profile Images Gallery (三视图) */}
                  {hasProfileImages && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="text-[10px] text-gray-500 mb-1.5">三视图</div>
                      <div className="flex gap-1.5 overflow-x-auto">
                        {profileImages.threeView && (
                          <img
                            src={profileImages.threeView}
                            alt="三视图"
                            className="h-16 rounded cursor-pointer hover:ring-2 ring-blue-500/50 object-cover"
                            onClick={() => setPreviewUrl(profileImages.threeView)}
                          />
                        )}
                        {(['front', 'side', 'back'] as const).map(vt => profileImages[vt] ? (
                          <img
                            key={vt}
                            src={profileImages[vt]}
                            alt={vt}
                            className="h-16 w-12 rounded cursor-pointer hover:ring-2 ring-blue-500/50 object-cover"
                            onClick={() => setPreviewUrl(profileImages[vt])}
                          />
                        ) : null)}
                      </div>
                    </div>
                  )}

                  {/* Generate / Upload Buttons (角色资产) */}
                  {tab === 'character' && !isEditing && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex gap-2">
                      <button
                        onClick={() => handleGenerateImages(assetId)}
                        disabled={!!genTaskId}
                        className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-600/20 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-50 transition-all"
                      >
                        {genTaskId ? '生成中...' : hasProfileImages ? '重新生成三视图' : '生成三视图'}
                      </button>
                      <button
                        onClick={() => {
                          setUploadingId(assetId);
                          fileInputRef.current?.click();
                        }}
                        disabled={uploadingId === assetId}
                        className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-all"
                      >
                        {uploadingId === assetId ? '上传中...' : '上传参考图'}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange(uploadingId || assetId)}
                      />
                    </div>
                  )}

                  {/* Gen task progress */}
                  {genTaskId && (
                    <AssetImageGenProgress
                      taskId={genTaskId}
                      onComplete={() => {
                        setGenTaskIds(prev => { const next = { ...prev }; delete next[assetId]; return next; });
                        onRefresh();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            {assets.length === 0 ? '请先在脚本面板提取资产' : `暂无${TAB_CONFIG.find(t => t.key === tab)?.label}资产`}
          </div>
        )}
      </div>
    </div>
  );
}
