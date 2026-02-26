// 全局角色面板 - 查看所有项目角色 + 创建新角色（MkAnime 风格）
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadMaterials } from '../services/uploadService';

interface CharItem {
  id: string;
  name: string;
  role: string;
  description: string;
  imageUrls: string[];
  confirmed: boolean;
  refImageUrl?: string;
  projectTitle: string;
  projectId: string;
  isLocal?: boolean; // 前端本地创建的角色
}

// 风格预设
const STYLE_PRESETS = [
  { id: 'urban', labelZh: '都市言情', labelEn: 'Urban Romance', emoji: '🏙' },
  { id: 'ink', labelZh: '水墨武侠', labelEn: 'Ink Wuxia', emoji: '🎨' },
  { id: 'anime', labelZh: '三渲二', labelEn: '3D Anime', emoji: '✨' },
  { id: 'retro', labelZh: '怀旧胶片', labelEn: 'Retro Film', emoji: '📷' },
  { id: 'comic', labelZh: '女频漫画', labelEn: 'Shoujo Manga', emoji: '💕' },
  { id: 'vintage', labelZh: '复古素描', labelEn: 'Vintage Sketch', emoji: '✏️' },
  { id: 'ghibli', labelZh: '吉卜力', labelEn: 'Ghibli', emoji: '🌿' },
  { id: '3d', labelZh: '3D国创', labelEn: '3D Chinese', emoji: '🐉' },
  { id: 'jojo', labelZh: 'JoJo', labelEn: 'JoJo', emoji: '⭐' },
];

export default function GlobalCharactersPanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [characters, setCharacters] = useState<CharItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [newCharAvatar, setNewCharAvatar] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState('urban');
  const avatarRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  useEffect(() => { loadAllCharacters(); }, []);

  const loadAllCharacters = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/drama/list');
      const data = await res.json();
      if (!data?.projects) { setLoading(false); return; }
      const items: CharItem[] = [];
      for (const p of data.projects) {
        const detail = await fetch(`/api/drama/${p.id}`).then(r => r.json()).catch(() => null);
        if (!detail?.project?.novel?.characters) continue;
        const title = detail.project.novel.title || '未命名';
        for (const c of detail.project.novel.characters) {
          if (c.role === 'minor') continue;
          items.push({ id: c.id, name: c.newName, role: c.role, description: c.description,
            imageUrls: c.imageUrls || [], confirmed: c.confirmed, refImageUrl: c.refImageUrl,
            projectTitle: title, projectId: p.id });
        }
      }
      setCharacters(items);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const allImages = characters.flatMap(c => c.imageUrls.map((url, i) => ({ url, name: `${c.name}_${i + 1}.png` })));

  const handleDownloadAll = () => {
    allImages.forEach(({ url, name }) => {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  };

  const handleCreateChar = async () => {
    if (!newCharName.trim()) return;
    // 如果有头像文件，先上传
    let avatarUrl = newCharAvatar;
    const newChar: CharItem = {
      id: `local_${Date.now()}`, name: newCharName.trim(), role: 'protagonist',
      description: newCharDesc.trim(), imageUrls: avatarUrl ? [avatarUrl] : [], confirmed: false,
      projectTitle: isZh ? '独立角色' : 'Standalone', projectId: '', isLocal: true,
    };
    setCharacters(prev => [newChar, ...prev]);
    setNewCharName(''); setNewCharDesc(''); setNewCharAvatar(null); setShowCreate(false);
  };

  // 头像上传处理
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    try {
      const urls = await uploadMaterials(e.target.files);
      if (urls.length > 0) setNewCharAvatar(urls[0]);
    } catch (err) { console.error('头像上传失败:', err); }
    e.target.value = '';
  };

  // 删除本地角色
  const handleDeleteChar = (charId: string) => {
    setCharacters(prev => prev.filter(c => c.id !== charId));
  };

  // 开始编辑角色
  const handleStartEdit = (char: CharItem) => {
    setEditingId(char.id);
    setEditName(char.name);
    setEditDesc(char.description);
  };

  // 保存编辑
  const handleSaveEdit = (charId: string) => {
    if (!editName.trim()) return;
    setCharacters(prev => prev.map(c =>
      c.id === charId ? { ...c, name: editName.trim(), description: editDesc.trim() } : c
    ));
    setEditingId(null);
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
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 space-y-8">
        {/* 当前风格 */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm text-gray-400">👁 {isZh ? '当前风格' : 'Current Style'}</span>
            <span className="text-sm text-white bg-[#222] px-3 py-1 rounded-lg border border-white/10">
              {STYLE_PRESETS.find(s => s.id === selectedStyle)?.[isZh ? 'labelZh' : 'labelEn']}
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {STYLE_PRESETS.map(style => (
              <button key={style.id} onClick={() => setSelectedStyle(style.id)}
                className={`flex-shrink-0 w-[100px] rounded-xl overflow-hidden border-2 transition-all ${
                  selectedStyle === style.id ? 'border-green-500' : 'border-transparent hover:border-white/20'
                }`}>
                <div className="aspect-[3/4] bg-[#1a1a1a] flex items-center justify-center text-2xl">{style.emoji}</div>
                <div className="py-1.5 text-center text-[11px] text-gray-400 bg-[#111] truncate px-1">
                  {isZh ? style.labelZh : style.labelEn}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 角色列表标题 + 操作 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">👥 {isZh ? '角色' : 'Characters'} ({characters.length})</span>
          </div>
          <div className="flex items-center gap-3">
            {allImages.length > 0 && (
              <button onClick={handleDownloadAll}
                className="w-10 h-10 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors" title={isZh ? '下载' : 'Download'}>
                ↓
              </button>
            )}
            <button onClick={() => setShowCreate(!showCreate)}
              className="w-10 h-10 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-green-400 flex items-center justify-center text-xl transition-colors" title={isZh ? '添加角色' : 'Add Character'}>
              +
            </button>
          </div>
        </div>

        {/* 创建角色卡片 - MkAnime 风格 */}
        {showCreate && (
          <div className="bg-[#161616] rounded-2xl border border-white/5 p-5">
            <div className="flex items-start gap-5">
              {/* 头像 - 点击上传 */}
              <div onClick={() => avatarRef.current?.click()}
                className="w-[180px] h-[220px] bg-[#1a1a1a] rounded-xl border border-dashed border-white/10 hover:border-green-500/50 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors overflow-hidden group">
                {newCharAvatar ? (
                  <img src={newCharAvatar} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-12 h-12 text-gray-700 group-hover:text-green-500/50 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span className="text-xs text-gray-600 group-hover:text-gray-400 transition-colors">{isZh ? '点击上传头像' : 'Click to upload'}</span>
                  </div>
                )}
                <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </div>
              {/* 表单 */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                  <input value={newCharName} onChange={e => setNewCharName(e.target.value)}
                    placeholder={isZh ? '角色名称' : 'Character name'} className="bg-transparent text-white text-base outline-none border-b border-white/10 pb-1 w-[240px] placeholder-gray-600 focus:border-green-500/50 transition-colors" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setShowCreate(false); setNewCharName(''); setNewCharDesc(''); setNewCharAvatar(null); }}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 transition-colors text-lg">✕</button>
                    <button onClick={handleCreateChar} disabled={!newCharName.trim()}
                      className="w-8 h-8 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 flex items-center justify-center text-white transition-colors">✓</button>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1.5">{isZh ? '角色描述' : 'Character Description'}</label>
                  <textarea value={newCharDesc} onChange={e => setNewCharDesc(e.target.value)}
                    placeholder={isZh ? '角色描述' : 'Character description'}
                    className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl px-4 py-3 text-sm text-gray-300 outline-none focus:border-green-500/30 resize-none h-[100px] placeholder-gray-600 transition-colors" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 角色列表 */}
        {characters.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-24 bg-[#161616] rounded-2xl border border-dashed border-white/10">
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-5">
              <span className="text-3xl opacity-40">👤</span>
            </div>
            <p className="text-base text-gray-500 font-medium">{isZh ? '暂无角色' : 'No characters yet'}</p>
            <p className="text-sm text-gray-600 mt-2">{isZh ? '创建项目并分析小说后，角色会显示在这里' : 'Characters will appear here after novel analysis'}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {characters.map((char, idx) => (
            <div key={`${char.projectId}_${char.id}_${idx}`} className="bg-[#161616] rounded-2xl border border-white/5 overflow-hidden group/card relative">
              {/* 编辑模式 */}
              {editingId === char.id ? (
                <div className="p-5 space-y-3">
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-green-500/50 transition-colors"
                    placeholder={isZh ? '角色名称' : 'Character name'} />
                  <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:border-green-500/50 resize-none h-[80px] transition-colors"
                    placeholder={isZh ? '角色描述' : 'Description'} />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{isZh ? '取消' : 'Cancel'}</button>
                    <button onClick={() => handleSaveEdit(char.id)} disabled={!editName.trim()}
                      className="px-3 py-1.5 rounded-lg text-xs bg-green-600 hover:bg-green-500 text-white disabled:bg-gray-700 transition-colors">{isZh ? '保存' : 'Save'}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-4 p-5">
                    {/* 头像 */}
                    <div className="w-20 h-24 bg-[#1a1a1a] rounded-xl border border-white/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {char.imageUrls.length > 0 ? (
                        <img src={char.imageUrls[0]} alt={char.name} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewImage(char.imageUrls[0])} />
                      ) : (
                        <span className="text-2xl opacity-30">👤</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base text-white font-medium truncate">{char.name}</span>
                        <span className="text-xs text-gray-500 bg-[#0e0e0e] px-2 py-0.5 rounded flex-shrink-0">{char.role}</span>
                        {char.confirmed && <span className="text-xs text-green-400 flex-shrink-0">✓</span>}
                      </div>
                      <p className="text-sm text-gray-500 line-clamp-2">{char.description}</p>
                      <p className="text-[11px] text-gray-700 mt-1">{char.projectTitle}</p>
                    </div>
                  </div>
                  {/* 图片行 */}
                  {char.imageUrls.length > 1 && (
                    <div className="px-5 pb-4 flex gap-2 overflow-x-auto">
                      {char.imageUrls.slice(1).map((url, i) => (
                        <img key={i} src={url} alt={`${char.name} ${i + 2}`} loading="lazy"
                          className="w-16 h-20 object-cover rounded-lg border border-white/5 cursor-pointer hover:border-white/20 flex-shrink-0 transition-colors"
                          onClick={() => setPreviewImage(url)} />
                      ))}
                    </div>
                  )}
                  {/* 本地角色操作按钮 - hover 显示 */}
                  {char.isLocal && (
                    <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
                      <button onClick={() => handleStartEdit(char)}
                        className="w-7 h-7 rounded-lg bg-black/60 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors" title={isZh ? '编辑' : 'Edit'}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteChar(char.id)}
                        className="w-7 h-7 rounded-lg bg-black/60 hover:bg-red-600/80 flex items-center justify-center text-gray-400 hover:text-white transition-colors" title={isZh ? '删除' : 'Delete'}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
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
