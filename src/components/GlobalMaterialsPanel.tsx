// 全局素材面板 - 查看所有项目的场景图和视频
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadMaterials, listMaterials, deleteMaterial, type UploadedFile } from '../services/uploadService';
import { DownloadIcon, CloseIcon, UploadIcon, FilmIcon, ImageIcon } from './Icons';

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
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 space-y-8">
        {/* Filter + 上传下载 */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-[#1a1a1a]/40 p-4 rounded-2xl border border-white/5 backdrop-blur-sm">
          <div className="flex items-center gap-2 bg-[#0a0a0a] p-1 rounded-xl border border-white/5">
            {(['all', 'images', 'videos'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${filter === f ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}>
                {f === 'all' ? (isZh ? '全部' : 'All') : f === 'images' ? (isZh ? '图片' : 'Images') : (isZh ? '视频' : 'Videos')}
                <span className="text-xs opacity-60 bg-black/20 px-1.5 py-0.5 rounded-md">
                  {f === 'all' ? allMaterials.length : f === 'images' ? images.length : videos.length}
                </span>
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()}
              className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition-all shadow-lg shadow-green-900/20 flex items-center gap-2">
              <UploadIcon className="w-4 h-4" />
              {isZh ? '上传素材' : 'Upload'}
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={handleUpload} />
            
            {allMaterials.length > 0 && (
              <button onClick={handleDownloadAll}
                className="px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white text-sm transition-all hover:bg-[#222] flex items-center gap-2">
                <DownloadIcon className="w-4 h-4" />
                {isZh ? '批量下载' : 'Download All'}
              </button>
            )}
          </div>
        </div>

        {allMaterials.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 bg-[#161616]/50 rounded-3xl border border-dashed border-white/10">
            <div className="w-20 h-20 bg-[#1a1a1a] rounded-3xl flex items-center justify-center mb-6 shadow-inner">
              <ImageIcon className="w-8 h-8 text-gray-600" />
            </div>
            <p className="text-lg text-gray-400 font-medium mb-2">{isZh ? '暂无素材' : 'No materials yet'}</p>
            <p className="text-sm text-gray-600 max-w-xs text-center">{isZh ? '角色、场景和分镜生成的素材会显示在这里，也可以手动上传。' : 'Materials from characters, scenes and storyboards will appear here.'}</p>
          </div>
        )}

        {/* Images */}
        {showImages && images.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              {isZh ? '图片素材' : 'Images'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {images.map((img, i) => (
                <div key={i} className="group/img relative cursor-pointer aspect-square rounded-2xl overflow-hidden bg-[#111] border border-white/5 hover:border-white/20 transition-all hover:shadow-xl hover:shadow-black/50" onClick={() => setPreviewImage(img.url)}>
                  <img src={img.url} alt={img.label} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <p className="text-xs text-white font-medium truncate">{img.label}</p>
                    <p className="text-[10px] text-gray-400 truncate">{img.projectTitle}</p>
                  </div>
                  {img.filename && (
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteMaterial(img.filename!); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all transform translate-y-[-10px] group-hover/img:translate-y-0"
                      title={isZh ? '删除' : 'Delete'}>
                      <CloseIcon className="w-3.5 h-3.5 text-white" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Videos */}
        {showVideos && videos.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FilmIcon className="w-4 h-4" />
              {isZh ? '视频素材' : 'Videos'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {videos.map((v, i) => (
                <div key={i} className="group/vid relative bg-[#161616] rounded-2xl border border-white/5 overflow-hidden hover:border-white/20 transition-all hover:shadow-xl hover:shadow-black/50 hover:translate-y-[-2px]">
                  <a href={`/api/video-proxy?url=${encodeURIComponent(v.url)}`} target="_blank" rel="noopener noreferrer" className="block relative">
                    <div className="aspect-video bg-black flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover/vid:opacity-100 transition-opacity" />
                      <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center group-hover/vid:scale-110 transition-transform border border-white/20">
                        <span className="text-xl ml-1">▶</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-green-400 truncate pr-2">{v.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 font-mono">MP4</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">{v.projectTitle}</div>
                    </div>
                  </a>
                  {v.filename && (
                    <button onClick={() => handleDeleteMaterial(v.filename!)}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-red-500/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/vid:opacity-100 transition-all"
                      title={isZh ? '删除' : 'Delete'}>
                      <CloseIcon className="w-4 h-4 text-white" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Image preview */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-md bg-black/90 animate-fade-in" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[95vw] max-h-[95vh]">
            <img src={previewImage} alt="preview" className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl shadow-black" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-12 right-0 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
              <CloseIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
