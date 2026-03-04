// 群演仓库面板 - 展示从小说转漫剧提取的角色Agent，按来源小说分类
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UserIcon, TrashIcon } from './Icons';

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

export default function CharacterAgentPanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [agents, setAgents] = useState<CharacterAgentItem[]>([]);
  const [grouped, setGrouped] = useState<Record<string, CharacterAgentItem[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CharacterAgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const fetchAgents = () => {
    fetch('/api/character-agents').then(r => r.json()).then(d => {
      if (d?.agents) setAgents(d.agents);
      if (d?.grouped) {
        setGrouped(d.grouped);
        // 默认展开所有分组
        setExpandedGroups(new Set(Object.keys(d.grouped)));
      }
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
    // 更新分组
    setGrouped(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter(a => a.id !== id);
        if (next[key].length === 0) delete next[key];
      }
      return next;
    });
    if (selectedId === id) { setSelectedId(null); setDetail(null); }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const roleLabel = (role: string) => {
    if (!isZh) return role;
    return role === 'protagonist' ? '主角' : role === 'supporting' ? '配角' : '龙套';
  };

  const roleColor = (role: string) => {
    return role === 'protagonist' ? 'text-yellow-400 bg-yellow-500/10' : role === 'supporting' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-400 bg-white/5';
  };

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

  const groupKeys = Object.keys(grouped);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center gap-2 mb-4 text-gray-400">
          <span className="text-lg">🎭</span>
          <span className="text-sm font-medium">{isZh ? '群演仓库' : 'Cast Agents'}</span>
          <span className="text-xs bg-white/5 px-2 py-0.5 rounded-full text-gray-500">{agents.length}</span>
        </div>

        {groupKeys.map(novelName => {
          const groupAgents = grouped[novelName] || [];
          const isExpanded = expandedGroups.has(novelName);
          return (
            <div key={novelName} className="rounded-2xl border border-white/5 overflow-hidden">
              {/* 分组标题 */}
              <button
                onClick={() => toggleGroup(novelName)}
                className="w-full flex items-center gap-3 px-5 py-4 bg-[#111] hover:bg-[#161616] transition-colors text-left"
              >
                <span className="text-base">📖</span>
                <span className="text-sm font-bold text-gray-200 flex-1">{novelName}</span>
                <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">{groupAgents.length} {isZh ? '个角色' : 'chars'}</span>
                <svg className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {isExpanded && (
                <div className="divide-y divide-white/5">
                  {groupAgents.map(a => (
                    <div key={a.id} className={`transition-all duration-300 ${selectedId === a.id ? 'bg-[#161616]' : 'bg-[#0d0d0d]'}`}>
                      <button onClick={() => handleSelect(a.id)}
                        className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]">
                        {/* 角色头像 */}
                        <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-[#1a1a1a]">
                          {a.profileImages?.main ? (
                            <img src={a.profileImages.main} alt={a.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <UserIcon className="w-5 h-5 text-gray-600" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`text-sm font-bold truncate ${selectedId === a.id ? 'text-white' : 'text-gray-300'}`}>{a.name}</h3>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${roleColor(a.role)}`}>{roleLabel(a.role)}</span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{a.personality || a.description}</p>
                        </div>
                      </button>

                      {/* 展开详情 */}
                      {selectedId === a.id && (
                        <div className="px-5 pb-5 pt-2 animate-fade-in">
                          <div className="border-t border-white/5 pt-4 space-y-4">
                            {loading ? (
                              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                                <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                                {isZh ? '加载详情...' : 'Loading...'}
                              </div>
                            ) : detail ? (
                              <>
                                {/* 角色描述 */}
                                <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '角色描述' : 'Description'}</p>
                                  <p className="text-sm text-gray-300 leading-relaxed">{detail.description}</p>
                                </div>

                                {/* 性格 & 视觉 */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                                {/* 角色档案图 */}
                                {detail.profileImages && Object.keys(detail.profileImages).length > 0 && (
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '角色档案图' : 'Profile Images'}</p>
                                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                      {Object.entries(detail.profileImages).map(([key, url]) => (
                                        url && typeof url === 'string' && (
                                          <img key={key} src={url} alt={key} className="w-20 h-20 rounded-lg object-cover border border-white/10 flex-shrink-0" />
                                        )
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* System Prompt */}
                                <div>
                                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '角色Agent提示词' : 'Character Agent Prompt'}</p>
                                  <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 font-mono text-xs text-gray-400 max-h-48 overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
                                    {detail.systemPrompt}
                                  </div>
                                </div>

                                {/* 标签 */}
                                {detail.tags?.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {detail.tags.map((tag, i) => (
                                      <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/5">{tag}</span>
                                    ))}
                                  </div>
                                )}

                                {/* 操作按钮 */}
                                <div className="flex gap-3 pt-2">
                                  <button onClick={() => {
                                    navigator.clipboard.writeText(detail.systemPrompt);
                                  }}
                                    className="flex-1 py-2.5 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-colors text-xs font-medium flex items-center justify-center gap-2">
                                    <span>📋</span> {isZh ? '复制提示词' : 'Copy Prompt'}
                                  </button>
                                  <button onClick={() => handleDelete(a.id)}
                                    className="px-6 py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium flex items-center gap-2">
                                    <TrashIcon className="w-3.5 h-3.5" /> {isZh ? '删除' : 'Delete'}
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
