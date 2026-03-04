// 全局角色面板 - 查看所有项目角色 + 创建新角色（MkAnime 风格）
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadMaterials } from '../services/uploadService';
import CharacterSheetGenerator from './CharacterSheetGenerator';
import { DownloadIcon, CloseIcon, UploadIcon, UserIcon, CheckIcon } from './Icons';

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
  const [generatingCharId, setGeneratingCharId] = useState<string | null>(null);

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

  // 生成角色设定图
  const handleGenerateSheet = async (prompt: string, negativePrompt: string): Promise<string> => {
    // 获取 sessionId（从环境变量或用户配置）
    const sessionId = localStorage.getItem('sessionId') || '';
    
    // 调用服务端生成图片
    const response = await fetch('/api/generate-character-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, negativePrompt, sessionId }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '生成失败');
    }
    
    const data = await response.json();
    return data.imageUrl;
  };

  // 保存生成的设定图
  const handleSaveSheet = (charId: string, imageUrl: string) => {
    setCharacters(prev => prev.map(c =>
      c.id === charId ? { ...c, imageUrls: [imageUrl, ...c.imageUrls] } : c
    ));
    setGeneratingCharId(null);
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
        {/* 当前风格 */}
        <div className="bg-[#1a1a1a]/40 p-4 rounded-2xl border border-white/5 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-bold text-gray-400 uppercase tracking-wider">👁 {isZh ? '当前风格' : 'Current Style'}</span>
            <span className="text-xs font-mono text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
              {STYLE_PRESETS.find(s => s.id === selectedStyle)?.[isZh ? 'labelZh' : 'labelEn']}
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {STYLE_PRESETS.map(style => (
              <button key={style.id} onClick={() => setSelectedStyle(style.id)}
                className={`flex-shrink-0 w-[100px] rounded-xl overflow-hidden border-2 transition-all group ${
                  selectedStyle === style.id ? 'border-green-500 shadow-lg shadow-green-900/20 scale-105' : 'border-transparent hover:border-white/20 hover:scale-105'
                }`}>
                <div className="aspect-[3/4] bg-[#1a1a1a] flex items-center justify-center text-3xl group-hover:bg-[#222] transition-colors">{style.emoji}</div>
                <div className={`py-2 text-center text-[10px] font-medium truncate px-1 ${selectedStyle === style.id ? 'bg-green-600 text-white' : 'bg-[#111] text-gray-400'}`}>
                  {isZh ? style.labelZh : style.labelEn}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 角色列表标题 + 操作 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-400">
              <UserIcon className="w-5 h-5 text-green-400" />
              {isZh ? '所有角色' : 'All Characters'}
              <span className="text-xs bg-white/5 px-2 py-0.5 rounded-full text-gray-500">{characters.length}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {allImages.length > 0 && (
              <button onClick={handleDownloadAll}
                className="w-10 h-10 rounded-xl bg-[#1a1a1a] border border-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-all hover:bg-[#222]" title={isZh ? '下载全部' : 'Download All'}>
                <DownloadIcon className="w-5 h-5" />
              </button>
            )}
            <button onClick={() => setShowCreate(!showCreate)}
              className={`px-4 py-2.5 rounded-xl border font-medium text-sm transition-all flex items-center gap-2 ${showCreate ? 'bg-white/10 border-white/20 text-white' : 'bg-green-600 border-green-500 text-white hover:bg-green-500'}`}>
              {showCreate ? <CloseIcon className="w-4 h-4" /> : <span className="text-lg leading-none">+</span>}
              {showCreate ? (isZh ? '取消' : 'Cancel') : (isZh ? '添加角色' : 'Add Character')}
            </button>
          </div>
        </div>

        {/* 创建角色卡片 - MkAnime 风格 */}
        {showCreate && (
          <div className="bg-[#161616] rounded-2xl border border-green-500/30 p-6 animate-fade-in shadow-xl shadow-green-900/10">
            <div className="flex flex-col md:flex-row items-start gap-6">
              {/* 头像 - 点击上传 */}
              <div onClick={() => avatarRef.current?.click()}
                className="w-full md:w-[200px] aspect-[3/4] bg-[#1a1a1a] rounded-xl border-2 border-dashed border-white/10 hover:border-green-500/50 flex items-center justify-center flex-shrink-0 cursor-pointer transition-all overflow-hidden group relative">
                {newCharAvatar ? (
                  <>
                    <img src={newCharAvatar} alt="avatar" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-xs text-white font-medium">更换头像</span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 p-4 text-center">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                      <UploadIcon className="w-6 h-6 text-gray-500 group-hover:text-green-400" />
                    </div>
                    <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">{isZh ? '点击上传头像' : 'Click to upload'}</span>
                  </div>
                )}
                <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </div>
              
              {/* 表单 */}
              <div className="flex-1 space-y-5 w-full">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">{isZh ? '角色名称' : 'Name'}</label>
                  <input value={newCharName} onChange={e => setNewCharName(e.target.value)}
                    placeholder={isZh ? '输入角色名称...' : 'Enter character name...'} 
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-4 py-3 text-lg text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-all" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">{isZh ? '角色描述' : 'Description'}</label>
                  <textarea value={newCharDesc} onChange={e => setNewCharDesc(e.target.value)}
                    placeholder={isZh ? '输入外貌、性格、特征等描述...' : 'Enter appearance, personality, traits...'}
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300 outline-none focus:border-green-500/50 resize-none h-[120px] placeholder-gray-600 transition-all" />
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={handleCreateChar} disabled={!newCharName.trim()}
                    className="px-8 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-[#222] disabled:text-gray-600 text-white font-bold transition-all shadow-lg shadow-green-900/20 hover:scale-[1.02]">
                    {isZh ? '创建角色' : 'Create Character'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 角色列表 */}
        {characters.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-32 bg-[#161616]/50 rounded-3xl border border-dashed border-white/10">
            <div className="w-20 h-20 bg-[#1a1a1a] rounded-3xl flex items-center justify-center mb-6 shadow-inner">
              <UserIcon className="w-10 h-10 text-gray-600" />
            </div>
            <p className="text-lg text-gray-400 font-medium mb-2">{isZh ? '暂无角色' : 'No characters yet'}</p>
            <p className="text-sm text-gray-600 max-w-xs text-center">{isZh ? '创建项目并分析小说后，角色会显示在这里，或者手动添加新角色。' : 'Characters will appear here after novel analysis, or add manually.'}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {characters.map((char, idx) => (
            <div key={`${char.projectId}_${char.id}_${idx}`} className="bg-[#161616] rounded-2xl border border-white/5 overflow-hidden group/card relative hover:border-white/20 transition-all hover:shadow-xl hover:shadow-black/50">
              {/* 生成设定图模式 */}
              {generatingCharId === char.id ? (
                <div className="p-5">
                  <CharacterSheetGenerator
                    characterName={char.name}
                    characterDesc={char.description}
                    onGenerate={handleGenerateSheet}
                    onSave={(imageUrl) => handleSaveSheet(char.id, imageUrl)}
                    existingImage={char.imageUrls[0]}
                  />
                  <button
                    onClick={() => setGeneratingCharId(null)}
                    className="w-full mt-3 text-gray-500 hover:text-white py-2 text-sm transition-colors"
                  >
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                </div>
              ) : editingId === char.id ? (
                <div className="p-5 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Name</label>
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-green-500/50 transition-colors"
                      placeholder={isZh ? '角色名称' : 'Character name'} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Description</label>
                    <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:border-green-500/50 resize-none h-[100px] transition-colors"
                      placeholder={isZh ? '角色描述' : 'Description'} />
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <button onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{isZh ? '取消' : 'Cancel'}</button>
                    <button onClick={() => handleSaveEdit(char.id)} disabled={!editName.trim()}
                      className="px-4 py-1.5 rounded-lg text-xs bg-green-600 hover:bg-green-500 text-white disabled:bg-gray-700 transition-colors font-medium">{isZh ? '保存' : 'Save'}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-4 p-5">
                    {/* 头像 */}
                    <div className="w-20 h-24 bg-[#1a1a1a] rounded-xl border border-white/5 flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer group/avatar" onClick={() => char.imageUrls.length > 0 && setPreviewImage(char.imageUrls[0])}>
                      {char.imageUrls.length > 0 ? (
                        <>
                          <img src={char.imageUrls[0]} alt={char.name} className="w-full h-full object-cover transition-transform duration-500 group-hover/avatar:scale-110" />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/avatar:opacity-100 transition-opacity" />
                        </>
                      ) : (
                        <UserIcon className="w-8 h-8 text-gray-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base text-white font-bold truncate">{char.name}</span>
                        <span className="text-[10px] text-gray-500 bg-[#0a0a0a] px-1.5 py-0.5 rounded border border-white/5 flex-shrink-0 uppercase tracking-wide">{char.role}</span>
                        {char.confirmed && <CheckIcon className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-2">{char.description}</p>
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
                        <p className="text-[10px] text-gray-600 truncate">{char.projectTitle}</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* 图片行 */}
                  {char.imageUrls.length > 1 && (
                    <div className="px-5 pb-5 flex gap-2 overflow-x-auto scrollbar-hide">
                      {char.imageUrls.slice(1).map((url, i) => (
                        <img key={i} src={url} alt={`${char.name} ${i + 2}`} loading="lazy"
                          className="w-12 h-16 object-cover rounded-lg border border-white/5 cursor-pointer hover:border-white/30 flex-shrink-0 transition-colors"
                          onClick={() => setPreviewImage(url)} />
                      ))}
                    </div>
                  )}
                  
                  {/* 本地角色操作按钮 - hover 显示 */}
                  {char.isLocal && (
                    <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-lg p-1 border border-white/10">
                      <button onClick={() => setGeneratingCharId(char.id)}
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="生成设定图">
                        <ImageIcon className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleStartEdit(char)}
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title={isZh ? '编辑' : 'Edit'}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteChar(char.id)}
                        className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title={isZh ? '删除' : 'Delete'}>
                        <CloseIcon className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-md bg-black/90 animate-fade-in" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="preview" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl shadow-black" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-12 right-0 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
              <CloseIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for ImageIcon since it wasn't imported
function ImageIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
