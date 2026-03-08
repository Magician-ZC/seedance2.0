// 经验管理面板 - 查看、筛选、编辑、删除经验记忆
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// 类型定义
// ============================================================

type ExperienceType = 'error_pattern' | 'success_pattern' | 'genre_rule' | 'audience_rule';

interface Experience {
  id: string;
  type: ExperienceType;
  genres: string;
  audience: string;
  summary: string;
  source_project_id: string;
  source_mode: 'loop' | 'arena';
  quality_score: number;
  reference_count: number;
  created_at: number;
  updated_at: number;
}

interface ExperienceStats {
  total: number;
  byType: Record<ExperienceType, number>;
  byGenre: Record<string, number>;
  avgQualityScore: number;
}

// ============================================================
// 常量
// ============================================================

const TYPE_CONFIG: Record<ExperienceType, { label: string; emoji: string; color: string; bg: string }> = {
  error_pattern:   { label: '错误模式', emoji: '⚠️', color: 'text-red-400',    bg: 'bg-red-500/10' },
  success_pattern: { label: '成功模式', emoji: '✅', color: 'text-green-400',  bg: 'bg-green-500/10' },
  genre_rule:      { label: '题材规律', emoji: '📚', color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  audience_rule:   { label: '受众规律', emoji: '👥', color: 'text-purple-400', bg: 'bg-purple-500/10' },
};

const MODE_LABEL: Record<string, string> = { loop: '闭环', arena: '竞技' };

// ============================================================
// 辅助函数
// ============================================================

function parseGenres(genresStr: string): string[] {
  try {
    const parsed = JSON.parse(genresStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-blue-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-gray-500';
}

function formatTime(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// 编辑弹窗组件
// ============================================================

function EditModal({ experience, onSave, onClose }: {
  experience: Experience;
  onSave: (id: string, fields: Partial<Experience>) => void;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState(experience.summary);
  const [genres, setGenres] = useState(parseGenres(experience.genres).join(', '));
  const [audience, setAudience] = useState(experience.audience);
  const [qualityScore, setQualityScore] = useState(String(experience.quality_score));

  const handleSave = () => {
    const genreArr = genres.split(/[,，]/).map(g => g.trim()).filter(Boolean);
    onSave(experience.id, {
      summary,
      genres: JSON.stringify(genreArr),
      audience,
      quality_score: Math.min(100, Math.max(0, Number(qualityScore) || 0)),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white">编辑经验</h3>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">经验摘要</label>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-green-500/50" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">适用题材（逗号分隔）</label>
            <input value={genres} onChange={e => setGenres(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">适用受众</label>
            <select value={audience} onChange={e => setAudience(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50">
              <option value="">通用</option>
              <option value="男频">男频</option>
              <option value="女频">女频</option>
              <option value="全年龄">全年龄</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">质量分数 (0-100)</label>
          <input type="number" min={0} max={100} value={qualityScore} onChange={e => setQualityScore(e.target.value)}
            className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">取消</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors">保存</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主面板组件
// ============================================================

export default function ExperiencePanel() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [stats, setStats] = useState<ExperienceStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<ExperienceType | ''>('');
  const [filterAudience, setFilterAudience] = useState('');
  const [editingExp, setEditingExp] = useState<Experience | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // 获取经验列表
  const fetchExperiences = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType) params.set('type', filterType);
    if (filterAudience) params.set('audience', filterAudience);
    const qs = params.toString();
    fetch(`/api/experiences${qs ? `?${qs}` : ''}`)
      .then(r => r.json())
      .then(data => { if (data?.experiences) setExperiences(data.experiences); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterType, filterAudience]);

  // 获取统计信息
  const fetchStats = useCallback(() => {
    fetch('/api/experiences/stats')
      .then(r => r.json())
      .then(data => { if (data?.total !== undefined) setStats(data); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchExperiences(); }, [fetchExperiences]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // 更新经验
  const handleUpdate = async (id: string, fields: Partial<Experience>) => {
    await fetch(`/api/experiences/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    fetchExperiences();
    fetchStats();
  };

  // 删除经验
  const handleDelete = async (id: string) => {
    await fetch(`/api/experiences/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    fetchExperiences();
    fetchStats();
  };

  // 从数据中提取受众选项
  const audienceOptions = useMemo(() => {
    const set = new Set<string>();
    experiences.forEach(e => { if (e.audience) set.add(e.audience); });
    return Array.from(set);
  }, [experiences]);

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{isZh ? '经验总数' : 'Total'}</p>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{isZh ? '平均质量' : 'Avg Quality'}</p>
            <p className={`text-2xl font-bold ${scoreColor(stats.avgQualityScore)}`}>{stats.avgQualityScore.toFixed(1)}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{isZh ? '类型分布' : 'By Type'}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {Object.entries(stats.byType).filter(([, v]) => v > 0).map(([k, v]) => (
                <span key={k} className={`text-xs px-1.5 py-0.5 rounded ${TYPE_CONFIG[k as ExperienceType]?.bg} ${TYPE_CONFIG[k as ExperienceType]?.color}`}>
                  {TYPE_CONFIG[k as ExperienceType]?.emoji} {v}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{isZh ? '题材分布' : 'By Genre'}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {Object.entries(stats.byGenre).slice(0, 5).map(([k, v]) => (
                <span key={k} className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-gray-300">{k}: {v}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value as ExperienceType | '')}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50">
          <option value="">{isZh ? '全部类型' : 'All Types'}</option>
          {Object.entries(TYPE_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.emoji} {v.label}</option>
          ))}
        </select>
        <select value={filterAudience} onChange={e => setFilterAudience(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50">
          <option value="">{isZh ? '全部受众' : 'All Audiences'}</option>
          {audienceOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={() => { fetchExperiences(); fetchStats(); }}
          className="ml-auto px-3 py-2 text-xs text-gray-400 hover:text-white bg-white/5 border border-white/10 rounded-lg transition-colors">
          🔄 {isZh ? '刷新' : 'Refresh'}
        </button>
      </div>

      {/* 经验列表 */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">{isZh ? '加载中...' : 'Loading...'}</div>
      ) : experiences.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-3">🧠</p>
          <p>{isZh ? '暂无经验记忆' : 'No experiences yet'}</p>
          <p className="text-xs mt-1 text-gray-600">{isZh ? '完成创作项目后会自动提取经验' : 'Experiences are extracted after project completion'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {experiences.map(exp => {
            const tc = TYPE_CONFIG[exp.type];
            const genres = parseGenres(exp.genres);
            return (
              <div key={exp.id} className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl p-4 transition-all">
                <div className="flex items-start gap-3">
                  {/* 类型标签 */}
                  <span className={`flex-shrink-0 text-xs px-2 py-1 rounded-lg ${tc.bg} ${tc.color} font-medium`}>
                    {tc.emoji} {tc.label}
                  </span>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 leading-relaxed">{exp.summary}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      {genres.length > 0 && (
                        <span>📚 {genres.join(', ')}</span>
                      )}
                      {exp.audience && <span>👥 {exp.audience}</span>}
                      <span>📊 {MODE_LABEL[exp.source_mode] || exp.source_mode}</span>
                      <span className={scoreColor(exp.quality_score)}>⭐ {exp.quality_score}</span>
                      <span>🔗 引用 {exp.reference_count}次</span>
                      <span>{formatTime(exp.updated_at)}</span>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex-shrink-0 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingExp(exp)} title="编辑"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                      ✏️
                    </button>
                    {deleteConfirm === exp.id ? (
                      <button onClick={() => handleDelete(exp.id)} title="确认删除"
                        className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-xs">
                        确认?
                      </button>
                    ) : (
                      <button onClick={() => setDeleteConfirm(exp.id)} title="删除"
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors">
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editingExp && (
        <EditModal experience={editingExp} onSave={handleUpdate} onClose={() => setEditingExp(null)} />
      )}
    </main>
  );
}
