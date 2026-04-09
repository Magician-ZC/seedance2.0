// 短剧制片 - 项目列表 + 新建入口
import { useState, useEffect, useCallback } from 'react';
import type { ProductionProjectListItem } from '../../types/production';
import * as api from '../../services/productionService';

interface ProductionHomeProps {
  onOpenProject: (projectId: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  created: { label: '已创建', color: 'text-gray-400' },
  script_uploaded: { label: '脚本已上传', color: 'text-blue-400' },
  cleaning: { label: '清洗中', color: 'text-yellow-400' },
  asset_extracting: { label: '资产提取中', color: 'text-purple-400' },
  asset_confirmed: { label: '资产已确认', color: 'text-green-400' },
  generating: { label: '视频生成中', color: 'text-orange-400' },
  voice_generating: { label: '配音中', color: 'text-pink-400' },
  compositing: { label: '合成中', color: 'text-cyan-400' },
  done: { label: '已完成', color: 'text-green-500' },
};

interface RunningTaskSummary { projectId: string; stage: string; progress: string }

export default function ProductionHome({ onOpenProject }: ProductionHomeProps) {
  const [projects, setProjects] = useState<ProductionProjectListItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [runningTasks, setRunningTasks] = useState<RunningTaskSummary[]>([]);

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.listProductionProjects();
      if (data?.projects) setProjects(data.projects);
    } catch { /* ignore */ }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const data = await api.getRunningTasks();
      if (data?.tasks) setRunningTasks(data.tasks);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadProjects();
    loadTasks();
    const t1 = setInterval(loadProjects, 10000);
    const t2 = setInterval(loadTasks, 5000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadProjects, loadTasks]);

  const getProjectRunning = (pid: string) => runningTasks.filter(t => t.projectId === pid);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    try {
      const data = await api.createProductionProject(newTitle.trim());
      if (data?.project) {
        setShowCreate(false);
        setNewTitle('');
        onOpenProject(data.project.id);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此制片项目及所有关联数据？')) return;
    await api.deleteProductionProject(id);
    loadProjects();
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">短剧制片</h1>
            <p className="text-sm text-gray-500 mt-1">从分镜脚本到成片的全流程制作</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20 transition-all hover:scale-105 active:scale-95"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>
            新建制片项目
          </button>
        </div>

        {/* Project Grid */}
        {projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {projects.map(proj => {
              const st = STATUS_LABELS[proj.status] || { label: proj.status, color: 'text-gray-400' };
              const running = getProjectRunning(proj.id);
              return (
                <div
                  key={proj.id}
                  onClick={() => onOpenProject(proj.id)}
                  className={`group relative bg-[#1a1a1a] border rounded-2xl p-5 cursor-pointer hover:bg-[#1a1a1a]/80 transition-all ${
                    running.length > 0 ? 'border-blue-500/30 shadow-lg shadow-blue-500/5' : 'border-white/5 hover:border-green-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center relative">
                      <svg className="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path d="M7 4v16M17 4v16M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4M3 4h18v16H3z" />
                      </svg>
                      {running.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(proj.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-gray-600 hover:text-red-400 transition-all"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                    </button>
                  </div>
                  <h3 className="text-sm font-semibold text-white truncate mb-1">{proj.title}</h3>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={st.color}>{st.label}</span>
                    <span className="text-gray-600">|</span>
                    <span className="text-gray-500">{proj.totalEpisodes}集</span>
                  </div>
                  {running.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {running.map(t => (
                        <div key={t.stage} className="flex items-center gap-1.5 text-[10px] text-blue-400">
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse shrink-0" />
                          <span className="truncate">{t.progress}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-600 mt-3">
                    {new Date(proj.updatedAt || proj.createdAt).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M7 4v16M17 4v16M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4M3 4h18v16H3z" />
              </svg>
            </div>
            <p className="text-gray-500 mb-2">还没有制片项目</p>
            <button onClick={() => setShowCreate(true)} className="text-green-400 text-sm hover:underline">
              创建第一个项目
            </button>
          </div>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowCreate(false)}>
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-semibold text-white mb-4">新建制片项目</h2>
              <label className="block text-sm text-gray-400 mb-2">项目名称</label>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="例如：《末日航线》第1-10集"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-green-500/50"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
              <p className="text-xs text-gray-600 mt-2">创建后可上传各集分镜脚本文件（.docx/.txt）</p>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors">取消</button>
                <button
                  onClick={handleCreate}
                  disabled={!newTitle.trim() || loading}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? '创建中...' : '创建项目'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
