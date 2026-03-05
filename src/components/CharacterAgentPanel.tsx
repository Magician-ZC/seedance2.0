// 群演仓库面板 - 卡片式布局 + 多维度筛选（角色类型/标签/来源）
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserIcon, TrashIcon, CloseIcon } from './Icons';
import FilterBar from './FilterBar';

interface CharacterAgentItem {
  id: string;
  name: string;
  role: string;
  category: string;
  description: string;
  personality: string;
  sourceNovel: string;
  visualPrompt: string;
  profileImages: Record<string, string>;
  tags: string[];
  createdAt: number;
}

interface CharacterAgentDetail extends CharacterAgentItem {
  systemPrompt: string;
  costumeDesc: string;
}

// 角色类型配置
const ROLE_CONFIG: Record<string, { zh: string; color: string; border: string; bg: string }> = {
  protagonist: { zh: '主角', color: 'text-yellow-400', border: 'border-yellow-500/20', bg: 'bg-yellow-500/10' },
  supporting:  { zh: '配角', color: 'text-blue-400',   border: 'border-blue-500/20',   bg: 'bg-blue-500/10' },
  minor:       { zh: '龙套', color: 'text-gray-400',   border: 'border-white/10',       bg: 'bg-white/5' },
};

export default function CharacterAgentPanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [agents, setAgents] = useState<CharacterAgentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CharacterAgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterNovel, setFilterNovel] = useState<string | null>(null);

  const fetchAgents = () => {
    fetch('/api/character-agents').then(r => r.json()).then(d => {
      if (d?.agents) setAgents(d.agents);
    }).catch(() => {});
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleSelect = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id); setLoading(true);
    try {
      const res = await fetch(`/api/character-agents/${id}`);
      const data = await res.json();
      if (data?.id) setDetail(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/character-agents/${id}`, { method: 'DELETE' });
    setAgents(prev => prev.filter(a => a.id !== id));
    if (selectedId === id) { setSelectedId(null); setDetail(null); }
  };

  const roleLabel = (role: string) => isZh ? (ROLE_CONFIG[role]?.zh || role) : role;
  const roleStyle = (role: string) => ROLE_CONFIG[role] || ROLE_CONFIG.minor;

  // 动态提取筛选维度
  const roleOptions = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach(a => { if (a.role) map.set(a.role, (map.get(a.role) || 0) + 1); });
    return Array.from(map, ([key, count]) => ({
      key, label: isZh ? (ROLE_CONFIG[key]?.zh || key) : key, count,
    }));
  }, [agents, isZh]);

  const tagOptions = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach(a => a.tags?.forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    return Array.from(map, ([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count).slice(0, 15);
  }, [agents]);

  const novelOptions = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach(a => { if (a.sourceNovel) map.set(a.sourceNovel, (map.get(a.sourceNovel) || 0) + 1); });
    return Array.from(map, ([key, count]) => ({ key, label: `📖 ${key}`, count }));
  }, [agents]);

  const filteredAgents = useMemo(() => {
    return agents.filter(a => {
      if (filterRole && a.role !== filterRole) return false;
      if (filterTag && !a.tags?.includes(filterTag)) return false;
      if (filterNovel && a.sourceNovel !== filterNovel) return false;
      return true;
    });
  }, [agents, filterRole, filterTag, filterNovel]);

  const hasFilter = filterRole || filterTag || filterNovel;
  const clearFilters = () => { setFilterRole(null); setFilterTag(null); setFilterNovel(null); };

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a]">
        <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-inner">
          <span className="text-4xl">🎭</span>
        </div>
        <p className="text-lg text-gray-400 font-medium mb-2">{isZh ? '暂无群演' : 'No Cast Agents'}</p>
        <p className="text-sm text-gray-600 max-w-xs text-center">{isZh ? '在小说转漫剧的角色确认步骤中，可将角色导出为群演Agent，以后创作时直接复用' : 'Export characters from Novel-to-Drama as reusable cast agents.'}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 space-y-6">
        {/* 筛选区域 */}
        <div className="bg-[#131313] rounded-2xl border border-white/5 p-4 space-y-3">
          {roleOptions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-12 flex-shrink-0">{isZh ? '类型' : 'Role'}</span>
              <FilterBar items={roleOptions} active={filterRole} onSelect={setFilterRole} allLabel={isZh ? '全部' : 'All'} />
            </div>
          )}
          {tagOptions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-12 flex-shrink-0">{isZh ? '特点' : 'Tags'}</span>
              <FilterBar items={tagOptions} active={filterTag} onSelect={setFilterTag} allLabel={isZh ? '全部' : 'All'} />
            </div>
          )}
          {novelOptions.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-12 flex-shrink-0">{isZh ? '来源' : 'Source'}</span>
              <FilterBar items={novelOptions} active={filterNovel} onSelect={setFilterNovel} allLabel={isZh ? '全部' : 'All'} />
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-gray-600">
              {filteredAgents.length === agents.length
                ? `${agents.length} ${isZh ? '个角色' : 'characters'}`
                : `${filteredAgents.length} / ${agents.length} ${isZh ? '个角色' : 'characters'}`}
            </span>
            {hasFilter && (
              <button onClick={clearFilters} className="text-[10px] text-gray-500 hover:text-green-400 transition-colors">
                {isZh ? '清除筛选' : 'Clear filters'}
              </button>
            )}
          </div>
        </div>

        {/* 角色卡片网格 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredAgents.map(a => {
            const rs = roleStyle(a.role);
            const mainImg = a.profileImages?.main;
            return (
              <div key={a.id} onClick={() => handleSelect(a.id)}
                className={`group/card relative rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:translate-y-[-2px] ${
                  selectedId === a.id ? 'border-green-500/30 shadow-xl shadow-green-900/10' : 'border-white/5 hover:border-white/15 hover:shadow-xl hover:shadow-black/50'
                }`}>
                <div className="aspect-[3/4] bg-[#111] relative overflow-hidden">
                  {mainImg ? (
                    <img src={mainImg} alt={a.name} className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-105" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1a1a1a] to-[#111]">
                      <UserIcon className="w-12 h-12 text-gray-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  <div className="absolute top-2.5 left-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${rs.color} ${rs.bg} ${rs.border} border backdrop-blur-sm`}>
                      {roleLabel(a.role)}
                    </span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                    className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-black/50 hover:bg-red-500/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all border border-white/10"
                    title={isZh ? '删除' : 'Delete'}>
                    <TrashIcon className="w-2.5 h-2.5 text-white" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-sm font-bold text-white mb-0.5 truncate">{a.name}</h3>
                    <p className="text-[10px] text-gray-300/70 line-clamp-2 leading-relaxed">{a.personality || a.description}</p>
                    {a.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {a.tags.slice(0, 2).map((tag, i) => (
                          <span key={i} className="text-[8px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300 backdrop-blur-sm">{tag}</span>
                        ))}
                        {a.tags.length > 2 && <span className="text-[8px] text-gray-500">+{a.tags.length - 2}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-3 py-2 bg-[#131313] flex items-center justify-between">
                  <span className="text-[9px] text-gray-500 truncate flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-green-500/50 flex-shrink-0" />
                    {a.sourceNovel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-gray-500 mb-2">{isZh ? '没有匹配的角色' : 'No matching characters'}</p>
            <button onClick={clearFilters} className="text-xs text-green-400 hover:text-green-300 transition-colors">
              {isZh ? '清除筛选' : 'Clear filters'}
            </button>
          </div>
        )}
      </div>

      {/* 详情侧滑面板 */}
      {selectedId && (
        <div className="fixed inset-0 z-[100] flex justify-end animate-fade-in" onClick={() => { setSelectedId(null); setDetail(null); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-[#111] border-l border-white/10 shadow-2xl overflow-y-auto custom-scrollbar animate-slide-in-right"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-[#111]/95 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg">🎭</span>
                <span className="text-sm font-bold text-white">{isZh ? '角色详情' : 'Character Details'}</span>
              </div>
              <button onClick={() => { setSelectedId(null); setDetail(null); }}
                className="p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : detail ? (
              <div className="space-y-5">
                {detail.profileImages?.main && (
                  <div className="relative aspect-[3/4] max-h-[360px] overflow-hidden">
                    <img src={detail.profileImages.main} alt={detail.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-6 right-6">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-xl font-bold text-white">{detail.name}</h2>
                        <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold ${roleStyle(detail.role).color} ${roleStyle(detail.role).bg} ${roleStyle(detail.role).border} border`}>
                          {roleLabel(detail.role)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300/80">{detail.sourceNovel}</p>
                    </div>
                  </div>
                )}
                <div className="px-6 space-y-5">
                  {!detail.profileImages?.main && (
                    <div className="flex items-center gap-3 pt-2">
                      <div className="w-14 h-14 rounded-2xl bg-[#1a1a1a] flex items-center justify-center">
                        <UserIcon className="w-7 h-7 text-gray-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-bold text-white">{detail.name}</h2>
                          <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold ${roleStyle(detail.role).color} ${roleStyle(detail.role).bg} ${roleStyle(detail.role).border} border`}>
                            {roleLabel(detail.role)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{detail.sourceNovel}</p>
                      </div>
                    </div>
                  )}
                  <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '角色描述' : 'Description'}</p>
                    <p className="text-sm text-gray-300 leading-relaxed">{detail.description}</p>
                  </div>
                  {(detail.personality || detail.costumeDesc) && (
                    <div className="grid grid-cols-1 gap-4">
                      {detail.personality && (
                        <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '性格特质' : 'Personality'}</p>
                          <p className="text-xs text-gray-400 leading-relaxed">{detail.personality}</p>
                        </div>
                      )}
                      {detail.costumeDesc && (
                        <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '服化道' : 'Costume'}</p>
                          <p className="text-xs text-gray-400 leading-relaxed">{detail.costumeDesc}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {detail.profileImages && Object.keys(detail.profileImages).length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{isZh ? '角色档案图' : 'Profile Images'}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(detail.profileImages).map(([key, url]) => (
                          url && typeof url === 'string' && (
                            <div key={key} className="relative group/img aspect-square rounded-xl overflow-hidden bg-[#0a0a0a] border border-white/5">
                              <img src={url} alt={key} className="w-full h-full object-cover transition-transform duration-300 group-hover/img:scale-110" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-end p-1.5">
                                <span className="text-[9px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-sm">{key}</span>
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {detail.tags.map((tag, i) => (
                        <span key={i} className="text-[10px] px-2.5 py-1 rounded-full bg-white/5 text-gray-400 border border-white/5">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '角色Agent提示词' : 'Character Agent Prompt'}</p>
                    <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 font-mono text-xs text-gray-400 max-h-48 overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
                      {detail.systemPrompt}
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2 sticky bottom-0 bg-[#111] py-4 border-t border-white/5">
                    <button onClick={() => { navigator.clipboard.writeText(detail.systemPrompt); }}
                      className="flex-1 py-3 rounded-xl bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors text-sm font-medium flex items-center justify-center gap-2 border border-green-500/20">
                      <span>📋</span> {isZh ? '复制提示词' : 'Copy Prompt'}
                    </button>
                    <button onClick={() => handleDelete(detail.id)}
                      className="px-6 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-sm font-medium flex items-center gap-2 border border-red-500/20">
                      <TrashIcon className="w-4 h-4" /> {isZh ? '删除' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
