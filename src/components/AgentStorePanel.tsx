// 作者仓库面板 - 卡片式布局 + 风格筛选
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserIcon, SparkleIcon, TrashIcon, CloseIcon } from './Icons';
import FilterBar from './FilterBar';

interface AgentItem {
  id: string;
  name: string;
  genre: string;
  tone: string;
  description: string;
  score: number;
  generation: number;
  sourceNovel: string;
  createdAt: number;
}

interface AgentDetail extends AgentItem {
  systemPrompt: string;
  styleDirective: string;
  techniqueWeights: Record<string, number>;
  scoreHistory: number[];
  mutationLog: string[];
}

// 评分 → 颜色映射
const scoreColor = (score: number) => {
  if (score >= 90) return { ring: 'ring-green-500/40', text: 'text-green-400', bg: 'bg-green-500/10', glow: 'shadow-green-500/20', bar: 'from-green-500 to-emerald-400' };
  if (score >= 75) return { ring: 'ring-blue-500/40', text: 'text-blue-400', bg: 'bg-blue-500/10', glow: 'shadow-blue-500/20', bar: 'from-blue-500 to-cyan-400' };
  if (score >= 60) return { ring: 'ring-yellow-500/40', text: 'text-yellow-400', bg: 'bg-yellow-500/10', glow: 'shadow-yellow-500/20', bar: 'from-yellow-500 to-amber-400' };
  return { ring: 'ring-gray-500/40', text: 'text-gray-400', bg: 'bg-gray-500/10', glow: 'shadow-gray-500/20', bar: 'from-gray-600 to-gray-500' };
};

// 风格 → emoji
const genreEmoji = (genre: string) => {
  const map: Record<string, string> = {
    '都市': '🏙', '言情': '💕', '玄幻': '⚡', '武侠': '⚔️', '悬疑': '🔍',
    '科幻': '🚀', '历史': '📜', '奇幻': '🧙', '恐怖': '👻', '喜剧': '😄',
    '校园': '🏫', '修真': '🌟', '仙侠': '☁️', '军事': '🎖',
    'urban': '🏙', 'romance': '💕', 'fantasy': '⚡', 'wuxia': '⚔️', 'mystery': '🔍',
  };
  const key = Object.keys(map).find(k => genre.toLowerCase().includes(k.toLowerCase()));
  return key ? map[key] : '✍️';
};

export default function AgentStorePanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterGenre, setFilterGenre] = useState<string | null>(null);
  const [filterTone, setFilterTone] = useState<string | null>(null);

  const fetchAgents = () => {
    fetch('/api/agents').then(r => r.json()).then(d => {
      if (d?.agents) setAgents(d.agents);
    }).catch(() => {});
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleSelect = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id); setLoading(true);
    try {
      const res = await fetch(`/api/agents/${id}`);
      const data = await res.json();
      if (data?.id) setDetail(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    setAgents(prev => prev.filter(a => a.id !== id));
    if (selectedId === id) { setSelectedId(null); setDetail(null); }
  };

  // 从数据中动态提取筛选维度
  const genreOptions = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach(a => { if (a.genre) map.set(a.genre, (map.get(a.genre) || 0) + 1); });
    return Array.from(map, ([key, count]) => ({ key, label: `${genreEmoji(key)} ${key}`, count }));
  }, [agents]);

  const toneOptions = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach(a => { if (a.tone) map.set(a.tone, (map.get(a.tone) || 0) + 1); });
    return Array.from(map, ([key, count]) => ({ key, label: key, count }));
  }, [agents]);

  // 筛选后的列表
  const filteredAgents = useMemo(() => {
    return agents.filter(a => {
      if (filterGenre && a.genre !== filterGenre) return false;
      if (filterTone && a.tone !== filterTone) return false;
      return true;
    });
  }, [agents, filterGenre, filterTone]);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a]">
        <div className="w-20 h-20 bg-[#161616] rounded-3xl flex items-center justify-center mb-6 shadow-inner">
          <UserIcon className="w-10 h-10 text-gray-600" />
        </div>
        <p className="text-lg text-gray-400 font-medium mb-2">{isZh ? '暂无作者Agent' : 'No Author Agents'}</p>
        <p className="text-sm text-gray-600 max-w-xs text-center">{isZh ? '请在创作工厂中训练并导出您的专属写作风格Agent' : 'Train and export your writing style agents in the Creative Factory.'}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 space-y-6">
        {/* 筛选区域 */}
        <div className="bg-[#131313] rounded-2xl border border-white/5 p-4 space-y-3">
          {/* 风格筛选 */}
          {genreOptions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-12 flex-shrink-0">{isZh ? '风格' : 'Genre'}</span>
              <FilterBar items={genreOptions} active={filterGenre} onSelect={setFilterGenre} allLabel={isZh ? '全部' : 'All'} />
            </div>
          )}
          {/* 语调筛选 */}
          {toneOptions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-12 flex-shrink-0">{isZh ? '语调' : 'Tone'}</span>
              <FilterBar items={toneOptions} active={filterTone} onSelect={setFilterTone} allLabel={isZh ? '全部' : 'All'} />
            </div>
          )}
          {/* 筛选结果计数 */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-gray-600">
              {filteredAgents.length === agents.length
                ? `${agents.length} ${isZh ? '个Agent' : 'agents'}`
                : `${filteredAgents.length} / ${agents.length} ${isZh ? '个Agent' : 'agents'}`}
            </span>
            {(filterGenre || filterTone) && (
              <button onClick={() => { setFilterGenre(null); setFilterTone(null); }}
                className="text-[10px] text-gray-500 hover:text-green-400 transition-colors">
                {isZh ? '清除筛选' : 'Clear filters'}
              </button>
            )}
          </div>
        </div>

        {/* 卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredAgents.map(a => {
            const sc = scoreColor(a.score);
            return (
              <div key={a.id}
                onClick={() => handleSelect(a.id)}
                className={`group/card relative rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:translate-y-[-2px] ${
                  selectedId === a.id
                    ? 'bg-[#161616] border-green-500/30 shadow-xl shadow-green-900/10'
                    : 'bg-[#131313] border-white/5 hover:border-white/15 hover:shadow-xl hover:shadow-black/50'
                }`}>
                {/* 顶部装饰条 */}
                <div className={`h-1 w-full bg-gradient-to-r ${sc.bar}`} />

                <div className="p-5">
                  {/* 头部：emoji + 名称 + 评分 */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${sc.bg} ring-2 ${sc.ring}`}>
                      {genreEmoji(a.genre)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-white truncate mb-1">{a.name}</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono bg-white/5 text-gray-500 px-1.5 py-0.5 rounded border border-white/5">{a.id.slice(0, 6)}</span>
                        <span className="text-[10px] text-gray-500">Gen {a.generation}</span>
                      </div>
                    </div>
                    <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 ${sc.bg} shadow-lg ${sc.glow}`}>
                      <span className={`text-xl font-bold font-mono leading-none ${sc.text}`}>{a.score}</span>
                      <span className="text-[8px] text-gray-500 uppercase tracking-widest mt-0.5">score</span>
                    </div>
                  </div>

                  {/* 标签行 */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">{a.genre}</span>
                    {a.tone && <span className="text-[11px] px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">{a.tone}</span>}
                    {a.sourceNovel && (
                      <span className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-gray-500 border border-white/5 truncate max-w-[140px]">📖 {a.sourceNovel}</span>
                    )}
                  </div>

                  {/* 描述 */}
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-2 mb-4">{a.description}</p>

                  {/* 底部 */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <span className="text-[10px] text-gray-600">
                      {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ''}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors" title={isZh ? '删除' : 'Delete'}>
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 筛选无结果 */}
        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-gray-500 mb-2">{isZh ? '没有匹配的Agent' : 'No matching agents'}</p>
            <button onClick={() => { setFilterGenre(null); setFilterTone(null); }}
              className="text-xs text-green-400 hover:text-green-300 transition-colors">
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
                <SparkleIcon className="w-5 h-5 text-green-400" />
                <span className="text-sm font-bold text-white">{isZh ? 'Agent 详情' : 'Agent Details'}</span>
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
              <div className="p-6 space-y-5">
                {/* Agent 头部 */}
                <div className="flex items-start gap-4">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0 ${scoreColor(detail.score).bg} ring-2 ${scoreColor(detail.score).ring}`}>
                    {genreEmoji(detail.genre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-white mb-1">{detail.name}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">{detail.genre}</span>
                      {detail.tone && <span className="text-[11px] px-2 py-0.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">{detail.tone}</span>}
                      <span className="text-[11px] text-gray-500">Gen {detail.generation}</span>
                    </div>
                  </div>
                  <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center ${scoreColor(detail.score).bg} shadow-lg ${scoreColor(detail.score).glow}`}>
                    <span className={`text-2xl font-bold font-mono leading-none ${scoreColor(detail.score).text}`}>{detail.score}</span>
                    <span className="text-[8px] text-gray-500 uppercase tracking-widest mt-0.5">score</span>
                  </div>
                </div>

                {/* 描述 */}
                <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                  <p className="text-sm text-gray-300 leading-relaxed">{detail.description}</p>
                </div>

                {/* 评分历史 & 进化路径 */}
                {detail.scoreHistory.length > 0 && (
                  <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{isZh ? '评分历史' : 'Score History'}</p>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                      {detail.scoreHistory.map((s, i) => (
                        <div key={i} className="flex items-center">
                          <span className={`font-mono text-xs px-2 py-1 rounded-lg ${i === detail.scoreHistory.length - 1 ? 'text-green-400 font-bold bg-green-500/10' : 'text-gray-500 bg-white/5'}`}>{s}</span>
                          {i < detail.scoreHistory.length - 1 && <span className="text-gray-700 mx-1">→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.mutationLog.length > 0 && (
                  <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{isZh ? '进化路径' : 'Evolution Path'}</p>
                    <div className="space-y-2 max-h-32 overflow-y-auto custom-scrollbar">
                      {detail.mutationLog.map((m, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
                          <span className="text-green-500 mt-0.5 flex-shrink-0">⚡</span>
                          <span>{m}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 风格指令 */}
                {detail.styleDirective && (
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '风格指令' : 'Style Directive'}</p>
                    <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                      {detail.styleDirective}
                    </div>
                  </div>
                )}

                {/* 技巧参数 */}
                {detail.techniqueWeights && Object.keys(detail.techniqueWeights).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '技巧参数' : 'Technique Weights'}</p>
                    <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 space-y-3">
                      {Object.entries(detail.techniqueWeights).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-500 w-28 truncate font-mono">{key}</span>
                          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-500/60 to-purple-400/80 rounded-full transition-all" style={{ width: `${(val as number) * 100}%` }} />
                          </div>
                          <span className="text-[11px] text-gray-400 font-mono w-8 text-right">{(val as number).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* System Prompt */}
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">System Prompt</p>
                  <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 font-mono text-xs text-gray-400 max-h-48 overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
                    {detail.systemPrompt}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-3 pt-2 sticky bottom-0 bg-[#111] py-4 -mx-6 px-6 border-t border-white/5">
                  <button onClick={() => { navigator.clipboard.writeText(detail.systemPrompt); }}
                    className="flex-1 py-3 rounded-xl bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors text-sm font-medium flex items-center justify-center gap-2 border border-green-500/20">
                    <span>📋</span> {isZh ? '复制 Prompt' : 'Copy Prompt'}
                  </button>
                  <button onClick={() => handleDelete(detail.id)}
                    className="px-6 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-sm font-medium flex items-center gap-2 border border-red-500/20">
                    <TrashIcon className="w-4 h-4" /> {isZh ? '删除' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
