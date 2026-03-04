// 作者仓库面板 - 展示从创作工厂导出的写作风格Agent提示词
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UserIcon, SparkleIcon, TrashIcon } from './Icons';

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

export default function AgentStorePanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);

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
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center gap-2 mb-4 text-gray-400">
          <SparkleIcon className="w-4 h-4" />
          <span className="text-sm font-medium">{isZh ? '已保存的作者Agent' : 'Saved Author Agents'}</span>
          <span className="text-xs bg-white/5 px-2 py-0.5 rounded-full text-gray-500">{agents.length}</span>
        </div>

        <div className="space-y-4">
          {agents.map(a => (
            <div key={a.id} className={`rounded-2xl border transition-all duration-300 overflow-hidden ${selectedId === a.id ? 'bg-[#161616] border-green-500/30 shadow-lg shadow-green-900/10' : 'bg-[#111] border-white/5 hover:border-white/10'}`}>
              <button onClick={() => handleSelect(a.id)}
                className="w-full flex items-center gap-5 p-5 text-left transition-colors hover:bg-white/[0.02]">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 transition-colors ${selectedId === a.id ? 'bg-green-500/20 text-green-400' : 'bg-[#1a1a1a] text-gray-500'}`}>
                  <UserIcon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`text-base font-bold truncate ${selectedId === a.id ? 'text-white' : 'text-gray-300'}`}>{a.name}</h3>
                    <span className="text-[10px] font-mono bg-white/5 text-gray-500 px-1.5 py-0.5 rounded border border-white/5">{a.id.slice(0, 6)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/50"></span> {a.genre}</span>
                    {a.tone && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500/50"></span> {a.tone}</span>}
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500/50"></span> Gen {a.generation}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-2xl font-bold text-green-500 font-mono">{a.score}</div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">SCORE</div>
                </div>
              </button>

              {selectedId === a.id && (
                <div className="px-5 pb-5 pt-2 animate-fade-in">
                  <div className="border-t border-white/5 pt-4 space-y-4">
                    {loading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                        <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                        {isZh ? '加载详情...' : 'Loading details...'}
                      </div>
                    ) : detail ? (
                      <>
                        <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                          <p className="text-sm text-gray-300 leading-relaxed">{detail.description}</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          {detail.scoreHistory.length > 0 && (
                            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '评分历史' : 'Score History'}</p>
                              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
                                {detail.scoreHistory.map((s, i) => (
                                  <div key={i} className="flex items-center">
                                    <span className={`font-mono text-xs ${i === detail.scoreHistory.length - 1 ? 'text-green-400 font-bold' : 'text-gray-500'}`}>{s}</span>
                                    {i < detail.scoreHistory.length - 1 && <span className="text-gray-700 mx-1">→</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {detail.mutationLog.length > 0 && (
                            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5">
                              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '进化路径' : 'Evolution Path'}</p>
                              <div className="space-y-1 max-h-20 overflow-y-auto custom-scrollbar">
                                {detail.mutationLog.map((m, i) => (
                                  <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
                                    <span className="text-green-500 mt-0.5">⚡</span>
                                    <span className="truncate">{m}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 风格指令 & 技巧参数 */}
                        {detail.styleDirective && (
                          <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '风格指令' : 'Style Directive'}</p>
                            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
                              {detail.styleDirective}
                            </div>
                          </div>
                        )}

                        {detail.techniqueWeights && Object.keys(detail.techniqueWeights).length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{isZh ? '技巧参数' : 'Technique Weights'}</p>
                            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 grid grid-cols-2 gap-3">
                              {Object.entries(detail.techniqueWeights).map(([key, val]) => (
                                <div key={key} className="flex items-center gap-2">
                                  <span className="text-[11px] text-gray-500 w-28 truncate font-mono">{key}</span>
                                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-purple-500/60 rounded-full transition-all" style={{ width: `${(val as number) * 100}%` }} />
                                  </div>
                                  <span className="text-[11px] text-gray-400 font-mono w-8 text-right">{(val as number).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">System Prompt</p>
                          <div className="bg-[#0a0a0a] rounded-xl p-4 border border-white/5 font-mono text-xs text-gray-400 max-h-48 overflow-y-auto custom-scrollbar leading-relaxed">
                            {detail.systemPrompt}
                          </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                          <button onClick={() => {
                            navigator.clipboard.writeText(detail.systemPrompt);
                            // Optional: Show toast
                          }}
                            className="flex-1 py-2.5 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-colors text-xs font-medium flex items-center justify-center gap-2">
                            <span>📋</span> {isZh ? '复制 Prompt' : 'Copy Prompt'}
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
      </div>
    </div>
  );
}
