import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SYSTEM_AGENTS } from '../constants/system-agents-data';
import FilterBar from './FilterBar';
import { SparkleIcon, CloseIcon } from './Icons';

// 风格emoji映射 - 复用AgentStorePanel的模式
const genreEmoji = (genre: string) => {
  const map: Record<string, string> = {
    '女频复仇': '🔥', '现实主义': '🎬', '全题材爆款': '💥', '流量算法': '📊',
    '马甲流': '🎭', '男频战神': '⚔️', '破碎美学': '💔', '高概念奇幻': '✨',
    '甜宠': '🍬', '潮流解构': '🎪',
  };
  return map[genre] || '✍️';
};

// 风格对应的渐变色
const genreGradient = (genre: string) => {
  const map: Record<string, string> = {
    '女频复仇': 'from-red-500/80 to-orange-500/80',
    '现实主义': 'from-gray-400/80 to-slate-500/80',
    '全题材爆款': 'from-amber-500/80 to-yellow-500/80',
    '流量算法': 'from-cyan-500/80 to-blue-500/80',
    '马甲流': 'from-purple-500/80 to-pink-500/80',
    '男频战神': 'from-red-600/80 to-red-400/80',
    '破碎美学': 'from-pink-500/80 to-rose-400/80',
    '高概念奇幻': 'from-indigo-500/80 to-violet-500/80',
    '甜宠': 'from-pink-400/80 to-rose-300/80',
    '潮流解构': 'from-emerald-500/80 to-teal-500/80',
  };
  return map[genre] || 'from-green-500/80 to-emerald-500/80';
};

export default function SystemAgentPanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const [filterGenre, setFilterGenre] = useState<string | null>(null);
  const [filterTone, setFilterTone] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 从静态数据中提取筛选维度
  const genreOptions = useMemo(() => {
    const map = new Map<string, number>();
    SYSTEM_AGENTS.forEach(a => map.set(a.genre, (map.get(a.genre) || 0) + 1));
    return Array.from(map, ([key, count]) => ({ key, label: `${genreEmoji(key)} ${key}`, count }));
  }, []);

  const toneOptions = useMemo(() => {
    const map = new Map<string, number>();
    SYSTEM_AGENTS.forEach(a => map.set(a.tone, (map.get(a.tone) || 0) + 1));
    return Array.from(map, ([key, count]) => ({ key, label: key, count }));
  }, []);

  // 筛选后的列表
  const filteredAgents = useMemo(() => {
    return SYSTEM_AGENTS.filter(a => {
      if (filterGenre && a.genre !== filterGenre) return false;
      if (filterTone && a.tone !== filterTone) return false;
      return true;
    });
  }, [filterGenre, filterTone]);

  const handleSelect = (id: string) => {
    setSelectedId(selectedId === id ? null : id);
  };

  const clearFilters = () => {
    setFilterGenre(null);
    setFilterTone(null);
  };

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
              {filteredAgents.length === SYSTEM_AGENTS.length
                ? `${SYSTEM_AGENTS.length} ${isZh ? '个Agent' : 'agents'}`
                : `${filteredAgents.length} / ${SYSTEM_AGENTS.length} ${isZh ? '个Agent' : 'agents'}`}
            </span>
            {(filterGenre || filterTone) && (
              <button onClick={clearFilters}
                className="text-[10px] text-gray-500 hover:text-green-400 transition-colors">
                {isZh ? '清除筛选' : 'Clear filters'}
              </button>
            )}
          </div>
        </div>

        {/* 卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredAgents.map(a => (
            <div key={a.id}
              onClick={() => handleSelect(a.id)}
              className={`group/card relative rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:translate-y-[-2px] ${
                selectedId === a.id
                  ? 'bg-[#161616] border-green-500/30 shadow-xl shadow-green-900/10'
                  : 'bg-[#131313] border-white/5 hover:border-white/15 hover:shadow-xl hover:shadow-black/50'
              }`}>
              {/* 顶部装饰条 */}
              <div className={`h-1 w-full bg-gradient-to-r ${genreGradient(a.genre)}`} />

              <div className="p-5">
                {/* 头部：emoji + 名称 */}
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 bg-white/5 ring-2 ring-white/10">
                    {genreEmoji(a.genre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-white truncate mb-1">{a.name}</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">{a.genre}</span>
                      <span className="text-[11px] px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">{a.tone}</span>
                    </div>
                  </div>
                </div>

                {/* 描述 */}
                <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{a.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 筛选无结果 */}
        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-gray-500 mb-2">{isZh ? '没有匹配的Agent' : 'No matching agents'}</p>
            <button onClick={clearFilters}
              className="text-xs text-green-400 hover:text-green-300 transition-colors">
              {isZh ? '清除筛选' : 'Clear filters'}
            </button>
          </div>
        )}
      </div>

      {/* 详情侧滑面板 */}
      {selectedId && (() => {
        const selectedAgent = SYSTEM_AGENTS.find(a => a.id === selectedId);
        if (!selectedAgent) return null;
        return (
          <div className="fixed inset-0 z-[100] flex justify-end animate-fade-in" onClick={() => { setSelectedId(null); }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg bg-[#111] border-l border-white/10 shadow-2xl overflow-y-auto custom-scrollbar animate-slide-in-right"
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 z-10 bg-[#111]/95 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <SparkleIcon className="w-5 h-5 text-green-400" />
                  <span className="text-sm font-bold text-white">{isZh ? 'Agent 详情' : 'Agent Details'}</span>
                </div>
                <button onClick={() => { setSelectedId(null); }}
                  className="p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Agent 头部 */}
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0 bg-white/5 ring-2 ring-white/10">
                    {genreEmoji(selectedAgent.genre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-white mb-1">{selectedAgent.name}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">{selectedAgent.genre}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">{selectedAgent.tone}</span>
                    </div>
                  </div>
                </div>

                {/* 描述 */}
                <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                  <p className="text-sm text-gray-300 leading-relaxed">{selectedAgent.description}</p>
                </div>

                {/* System Prompt */}
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">System Prompt</p>
                  <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 font-mono text-xs text-gray-400 max-h-96 overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
                    {selectedAgent.systemPrompt}
                  </div>
                </div>

                {/* 复制 Prompt 按钮 */}
                <div className="flex gap-3 pt-2 sticky bottom-0 bg-[#111] py-4 -mx-6 px-6 border-t border-white/5">
                  <button onClick={() => {
                    navigator.clipboard.writeText(selectedAgent.systemPrompt);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                    className="flex-1 py-3 rounded-xl bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors text-sm font-medium flex items-center justify-center gap-2 border border-green-500/20">
                    <span>{copied ? '✅' : '📋'}</span> {copied ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制 Prompt' : 'Copy Prompt')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
