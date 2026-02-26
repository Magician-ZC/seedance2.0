// 全局素材面板 - 查看所有项目的场景图和视频
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadMaterials, listMaterials, deleteMaterial, type UploadedFile } from '../services/uploadService';

interface MaterialItem {
  url: string;
  label: string;
  type: 'scene' | 'ref' | 'video';
  projectTitle: string;
  projectId: string;
  filename?: string; // 手动上传的素材文件名，用于删除
}

type MatFilter = 'all' | 'images' | 'videos';

export default function GlobalMaterialsPanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [filter, setFilter] = useState<MatFilter>('all');
  const [loading, setLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAllMaterials();
  }, []);

  const loadAllMaterials = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/drama/list');
      const data = await res.json();
      if (!data?.projects) { setLoading(false); return; }
      const items: MaterialItem[] = [];
      for (const p of data.projects) {
        const detail = await fetch(`/api/drama/${p.id}`).then(r => r.json()).catch(() => null);
        if (!detail?.project) continue;
        const proj = detail.project;
        const title = proj.novel?.title || '未命名';
        // 场景图
        proj.novel?.locations?.forEach((l: { imageUrl?: string; newName: string }) => {
          if (l.imageUrl) items.push({ url: l.imageUrl, label: l.newName, type: 'scene', projectTitle: title, projectId: p.id });
        });
        // 参考图
        proj.episodes?.forEach((ep: { number: number; refImageUrls?: string[] }) => {
          ep.refImageUrls?.forEach(url => items.push({ url, label: `E${ep.number}`, type: 'ref', projectTitle: title, projectId: p.id }));
        });
        // 视频
        proj.episodes?.forEach((ep: { number: number; title: string; videoUrl?: string; videoStatus?: string }) => {
          if (ep.videoUrl && ep.videoStatus === 'done') items.push({ url: ep.videoUrl, label: `E${ep.number} ${ep.title}`, type: 'video', projectTitle: title, projectId: p.id });
        });
      }
      setMaterials(items);
      // 同时加载手动上传的素材
      const uploaded = await listMaterials();
      setUploadedFiles(uploaded);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    try {
      await uploadMaterials(e.target.files);
      const uploaded = await listMaterials();
      setUploadedFiles(uploaded);
    } catch (err) { console.error('上传失败:', err); }
    e.target.value = '';
  };

  const handleDeleteMaterial = async (filename: string) => {
    const ok = await deleteMaterial(filename);
    if (ok) setUploadedFiles(prev => prev.filter(f => f.name !== filename));
  };

  // 将手动上传的素材合并到图片列表
  const uploadedImages: MaterialItem[] = uploadedFiles
    .filter(f => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name))
    .map(f => ({ url: f.url, label: f.name, type: 'scene' as const, projectTitle: isZh ? '手动上传' : 'Uploaded', projectId: '', filename: f.name }));
  const uploadedVideos: MaterialItem[] = uploadedFiles
    .filter(f => /\.(mp4|webm|mov|avi)$/i.test(f.name))
    .map(f => ({ url: f.url, label: f.name, type: 'video' as const, projectTitle: isZh ? '手动上传' : 'Uploaded', projectId: '', filename: f.name }));
  const allMaterials = [...materials, ...uploadedImages, ...uploadedVideos];
  const images = allMaterials.filter(m => m.type !== 'video');
  const videos = allMaterials.filter(m => m.type === 'video');
  const showImages = filter === 'all' || filter === 'images';
  const showVideos = filter === 'all' || filter === 'videos';

  const handleDownloadAll = () => {
    const items = filter === 'videos' ? videos : filter === 'images' ? images : allMaterials;
    items.forEach(({ url, label }) => {
      const a = document.createElement('a');
      a.href = url; a.download = label; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 space-y-6">
        {/* Filter + 上传下载 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(['all', 'images', 'videos'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${filter === f ? 'bg-white/10 text-white border border-white/10' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}>
                {f === 'all' ? `🗂 ${isZh ? '全部' : 'All'}` : f === 'images' ? `🖼 ${isZh ? '图片' : 'Images'} (${images.length})` : `🎬 ${isZh ? '视频' : 'Videos'} (${videos.length})`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()}
              className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-2">
              ↑ {isZh ? '上传' : 'Upload'}
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={handleUpload} />
            {allMaterials.length > 0 && (
              <button onClick={handleDownloadAll}
                className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-2">
                ↓ {isZh ? '下载' : 'Download'}
              </button>
            )}
          </div>
        </div>

        {allMaterials.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 bg-[#161616] rounded-2xl border border-dashed border-white/10">
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-5">
              <span className="text-3xl opacity-40">🖼</span>
            </div>
            <p className="text-base text-gray-500 font-medium">{isZh ? '暂无素材' : 'No materials yet'}</p>
            <p className="text-sm text-gray-600 mt-2">{isZh ? '角色、场景和分镜生成的素材会显示在这里' : 'Materials from characters, scenes and storyboards will appear here'}</p>
          </div>
        )}

        {/* Images */}
        {showImages && images.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
            {images.map((img, i) => (
              <div key={i} className="group/img relative cursor-pointer" onClick={() => setPreviewImage(img.url)}>
                <img src={img.url} alt={img.label} loading="lazy" className="w-full aspect-square object-cover rounded-xl border border-white/5 group-hover/img:border-white/20 transition-colors" />
                {img.filename && (
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteMaterial(img.filename!); }}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all"
                    title={isZh ? '删除' : 'Delete'}>
                    <span className="text-white text-xs">✕</span>
                  </button>
                )}
                <div className="mt-1.5 text-xs text-gray-500 truncate">{img.label}</div>
                <div className="text-[10px] text-gray-700 truncate">{img.projectTitle}</div>
              </div>
            ))}
          </div>
        )}

        {/* Videos */}
        {showVideos && videos.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {videos.map((v, i) => (
              <div key={i} className="group/vid relative bg-[#161616] rounded-xl border border-white/5 overflow-hidden hover:border-white/10 transition-colors">
                <a href={`/api/video-proxy?url=${encodeURIComponent(v.url)}`} target="_blank" rel="noopener noreferrer">
                  <div className="aspect-video bg-black flex items-center justify-center text-3xl">▶</div>
                  <div className="p-3 text-sm">
                    <span className="text-green-400 font-medium">{v.label}</span>
                    <div className="text-xs text-gray-600 mt-1 truncate">{v.projectTitle}</div>
                  </div>
                </a>
                {v.filename && (
                  <button onClick={() => handleDeleteMaterial(v.filename!)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover/vid:opacity-100 transition-all"
                    title={isZh ? '删除' : 'Delete'}>
                    <span className="text-white text-sm">✕</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Image preview */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setPreviewImage(null)}>
          <div className="absolute inset-0 bg-black/80" />
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
            <button onClick={() => setPreviewImage(null)} className="absolute top-2 right-2 p-2 bg-black/60 rounded-full hover:bg-black/80">
              <span className="text-white text-lg">✕</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
