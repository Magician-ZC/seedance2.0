// Agent仓库面板 - 展示从创作工厂导出的写作Agent
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-2xl">🤖</p>
          <p className="text-sm text-gray-500">{isZh ? '暂无Agent，请在创作工厂中训练并导出' : 'No agents yet. Train and export from Creative Factory.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
      <div className="max-w-4xl mx-auto space-y-3">
        {agents.map(a => (
          <div key={a.id} className="rounded-xl bg-[#111] border border-white/10 overflow-hidden">
            <button onClick={() => handleSelect(a.id)}
              className={`w-full flex items-center gap-4 p-4 text-left transition-colors hover:bg-white/5 ${selectedId === a.id ? 'bg-white/5' : ''}`}>
              <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center text-green-400 text-lg flex-shrink-0">🤖</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{a.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {a.genre}{a.tone ? ` · ${a.tone}` : ''} · {isZh ? `第${a.generation}代` : `Gen ${a.generation}`} · {a.score}{isZh ? '分' : 'pts'}
                </p>
              </div>
              <div className="text-xs text-gray-600">{new Date(a.createdAt).toLocaleDateString()}</div>
            </button>

            {selectedId === a.id && (
              <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                {loading ? (
                  <p className="text-xs text-gray-500">{isZh ? '加载中...' : 'Loading...'}</p>
                ) : detail ? (
                  <>
                    <p className="text-xs text-gray-400">{detail.description}</p>
                    {detail.scoreHistory.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{isZh ? '评分历史' : 'Score History'}</p>
                        <p className="text-xs text-gray-400">{detail.scoreHistory.join(' → ')}</p>
                      </div>
                    )}
                    {detail.mutationLog.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{isZh ? '进化路径' : 'Evolution Path'}</p>
                        {detail.mutationLog.map((m, i) => <p key={i} className="text-xs text-gray-400">• {m}</p>)}
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">System Prompt</p>
                      <pre className="text-xs text-gray-400 bg-black/30 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">{detail.systemPrompt}</pre>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => navigator.clipboard.writeText(detail.systemPrompt)}
                        className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-300 hover:bg-white/10 transition-colors">
                        📋 {isZh ? '复制Prompt' : 'Copy Prompt'}
                      </button>
                      <button onClick={() => handleDelete(a.id)}
                        className="px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors">
                        🗑️ {isZh ? '删除' : 'Delete'}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
