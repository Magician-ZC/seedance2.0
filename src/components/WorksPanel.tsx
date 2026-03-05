import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getHistory, removeHistory, clearHistory, type HistoryRecord } from '../services/historyService';
import VideoThumbnail from './VideoThumbnail';
import Banner from './Banner';
import { PlusIcon, DownloadIcon, BookIcon, SparkleIcon, FilmIcon, TrashIcon } from './Icons';

interface WorksPanelProps {
  onNewProject: () => void;
  onOpenNovelToDrama: () => void;
  onOpenVideoGen: () => void;
  onOpenScreenplayCreator: () => void;
  onOpenAgentFactory?: () => void;
  onSelectHistory: (record: HistoryRecord) => void;
  onOpenProject?: (projectId: string) => void;
  onOpenScreenplayProject?: (projectId: string) => void;
}

interface DramaProjectItem {
  id: string;
  title: string;
  status: string;
  style: string;
  targetEpisodes: number;
  createdAt: number;
  updatedAt: number;
}

interface ScreenplayProjectItem {
  id: string;
  title: string;
  status: string;
  genres: string;
  totalEpisodes: number;
  episodesWritten: number;
  createdAt: number;
  updatedAt: number;
}

export default function WorksPanel({ onNewProject, onOpenNovelToDrama, onOpenVideoGen, onOpenScreenplayCreator, onOpenAgentFactory, onSelectHistory, onOpenProject, onOpenScreenplayProject }: WorksPanelProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'done' | 'error'>('all');
  const [dramaProjects, setDramaProjects] = useState<DramaProjectItem[]>([]);
  const [screenplayProjects, setScreenplayProjects] = useState<ScreenplayProjectItem[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string; type?: 'drama' | 'screenplay' } | null>(null);
  const [factoryActiveCount, setFactoryActiveCount] = useState(0);

  const loadProjects = () => {
    fetch('/api/drama/list').then(r => r.json()).then(data => {
      if (data?.projects) {
        setDramaProjects(data.projects.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          title: (p as Record<string, Record<string, string>>).novel?.title || '未命名项目',
          status: p.status as string,
          style: p.style as string,
          targetEpisodes: p.targetEpisodes as number,
          createdAt: p.createdAt as number,
          updatedAt: (p.updatedAt || p.createdAt) as number,
        })));
      }
    }).catch(() => {});
    // 加载剧本项目
    fetch('/api/screenplay/list').then(r => r.json()).then(data => {
      if (data?.projects) {
        setScreenplayProjects(data.projects.map((p: Record<string, unknown>) => {
          const config = p.config as Record<string, unknown> || {};
          const plan = p.creativePlan as Record<string, unknown> | undefined;
          const titleOpts = plan?.titleOptions as Array<{ title: string }> | undefined;
          return {
            id: p.id as string,
            title: (p.selectedTitle as string) || titleOpts?.[0]?.title || (config.genres as string[])?.join('+') || '未命名剧本',
            status: p.status as string,
            genres: ((config.genres as string[]) || []).join('+'),
            totalEpisodes: (config.totalEpisodes as number) || 0,
            episodesWritten: ((p.episodes as unknown[]) || []).length,
            createdAt: p.createdAt as number,
            updatedAt: (p.updatedAt || p.createdAt) as number,
          };
        }));
      }
    }).catch(() => {});
    // 加载创作工厂活跃项目数
    fetch('/api/factory/list').then(r => r.json()).then(data => {
      if (data?.projects) setFactoryActiveCount(data.projects.filter((p: { status: string }) => p.status !== 'completed').length);
    }).catch(() => {});
  };

  useEffect(() => {
    setRecords(getHistory());
    loadProjects();
    // 定时刷新项目状态（后台任务可能在进行中）
    const timer = setInterval(loadProjects, 10000);
    return () => clearInterval(timer);
  }, []);

  const handleDeleteProject = async (keepAssets: boolean) => {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.type === 'screenplay') {
        await fetch(`/api/screenplay/${deleteConfirm.id}`, { method: 'DELETE' });
        setScreenplayProjects(prev => prev.filter(p => p.id !== deleteConfirm.id));
      } else {
        await fetch(`/api/drama/${deleteConfirm.id}${keepAssets ? '' : '?deleteAssets=true'}`, { method: 'DELETE' });
        setDramaProjects(prev => prev.filter(p => p.id !== deleteConfirm.id));
      }
    } catch { /* ignore */ }
    setDeleteConfirm(null);
  };

  const filtered = filter === 'all' ? records : records.filter((r) => r.status === filter);

  const handleDelete = (id: string) => {
    removeHistory(id);
    setRecords(getHistory());
  };

  const handleClearAll = () => {
    clearHistory();
    setRecords([]);
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 space-y-10">
        {/* Banner */}
        <Banner />

        {/* Action Bar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#1a1a1a]/40 p-4 rounded-2xl border border-white/5 backdrop-blur-sm">
           <div className="flex items-center gap-3 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-hide">
            <button
              onClick={onNewProject}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20 transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
            >
              <PlusIcon className="w-4 h-4" />
              {isZh ? '新建项目' : 'New Project'}
            </button>
            <div className="w-[1px] h-6 bg-white/10 mx-1" />
            <button
              onClick={() => {
                const activeCount = screenplayProjects.filter(p => p.status !== 'exported').length;
                if (activeCount >= 5) {
                  alert(isZh ? '最多同时进行5个剧本项目，请先完成或删除现有项目' : 'Max 5 concurrent projects');
                  return;
                }
                onOpenScreenplayCreator();
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all whitespace-nowrap"
            >
              <BookIcon className="w-4 h-4 text-blue-400" />
              {isZh ? '剧本创作' : 'Screenplay'}
              {screenplayProjects.filter(p => p.status !== 'exported').length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-green-500/20 text-green-400 border border-green-500/20">
                  {screenplayProjects.filter(p => p.status !== 'exported').length}/5
                </span>
              )}
            </button>
            <button
              onClick={onOpenAgentFactory}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all whitespace-nowrap"
            >
              <SparkleIcon className="w-4 h-4 text-purple-400" />
              {isZh ? '创作工厂' : 'Agent Factory'}
              {factoryActiveCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/20">
                  {factoryActiveCount}
                </span>
              )}
            </button>
            <button
              onClick={onOpenNovelToDrama}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all whitespace-nowrap"
            >
              <BookIcon className="w-4 h-4 text-green-400" />
              {isZh ? '小说转短剧' : 'Novel→Drama'}
            </button>
            <button
              onClick={onOpenVideoGen}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all whitespace-nowrap"
            >
              <FilmIcon className="w-4 h-4 text-cyan-400" />
              {isZh ? '单视频生成' : 'Single Video'}
            </button>
          </div>
        </div>

        {/* Drama Projects */}
        {dramaProjects.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="w-1 h-4 bg-green-500 rounded-full"></span>
                {isZh ? '短剧项目' : 'Drama Projects'}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {dramaProjects.map(proj => (
                <DramaCard key={proj.id} project={proj} isZh={isZh}
                  onClick={() => onOpenProject?.(proj.id)}
                  onDelete={() => setDeleteConfirm({ id: proj.id, title: proj.title })} />
              ))}
            </div>
          </section>
        )}

        {/* Screenplay Projects */}
        {screenplayProjects.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                {isZh ? '剧本项目' : 'Screenplay Projects'}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {screenplayProjects.map(proj => (
                <ScreenplayCard key={proj.id} project={proj} isZh={isZh}
                  onClick={() => onOpenScreenplayProject?.(proj.id)}
                  onDelete={() => setDeleteConfirm({ id: proj.id, title: proj.title, type: 'screenplay' })} />
              ))}
            </div>
          </section>
        )}

        {/* History Section */}
        <section>
          <div className="flex items-center justify-between mb-4 px-1">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
              {isZh ? '历史记录' : 'History'}
            </h2>
            
            <div className="flex items-center gap-2 bg-[#1a1a1a] p-1 rounded-lg border border-white/5">
              {(['all', 'done', 'error'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    filter === f
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}
                >
                  {f === 'all'
                    ? (isZh ? '全部' : 'All')
                    : f === 'done'
                      ? (isZh ? '成功' : 'Success')
                      : (isZh ? '失败' : 'Failed')}
                </button>
              ))}
              {records.length > 0 && (
                <>
                  <div className="w-[1px] h-4 bg-white/10 mx-1" />
                  <button
                    onClick={handleClearAll}
                    className="px-2 text-xs text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    {isZh ? '清空' : 'Clear'}
                  </button>
                </>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState isZh={isZh} onNewProject={onNewProject} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filtered.map((record) => (
                <ProjectCard
                  key={record.id}
                  record={record}
                  isZh={isZh}
                  onSelect={() => onSelectHistory(record)}
                  onDelete={() => handleDelete(record.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="relative bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">{isZh ? '删除项目' : 'Delete Project'}</h3>
            <p className="text-sm text-gray-400 mb-1">
              {isZh ? `确定要删除「${deleteConfirm.title}」吗？` : `Delete "${deleteConfirm.title}"?`}
            </p>
            <p className="text-xs text-gray-500 mb-6">
              {isZh ? '此操作无法撤销。' : 'This action cannot be undone.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button onClick={() => handleDeleteProject(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-[#222] border border-white/10 text-gray-300 hover:text-white hover:bg-[#333] transition-colors">
                {isZh ? '仅删除项目' : 'Project Only'}
              </button>
              <button onClick={() => handleDeleteProject(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600/10 border border-red-600/20 text-red-500 hover:bg-red-600 hover:text-white transition-all">
                {isZh ? '全部删除' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Empty State ---- */
function EmptyState({ isZh, onNewProject }: { isZh: boolean; onNewProject: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-[#141414]/30 rounded-2xl border border-white/5 border-dashed">
      <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-4 shadow-inner">
        <PlusIcon className="w-6 h-6 text-gray-600" />
      </div>
      <p className="text-gray-500 text-sm mb-6">{isZh ? '还没有任何项目' : 'No projects yet'}</p>
      <button
        onClick={onNewProject}
        className="px-6 py-2.5 rounded-full text-sm font-medium border border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500/50 transition-all"
      >
        {isZh ? '创建我的漫剧！' : 'Create my first project!'}
      </button>
    </div>
  );
}

/* ---- Project Card ---- */
function ProjectCard({
  record,
  isZh,
  onSelect,
  onDelete,
}: {
  record: HistoryRecord;
  isZh: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group bg-[#141414] border border-white/5 rounded-2xl overflow-hidden hover:border-white/20 hover:shadow-lg hover:shadow-black/50 transition-all duration-300 cursor-pointer flex flex-col h-full"
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-black relative overflow-hidden">
        {record.videoUrl && record.status === 'done' ? (
          <VideoThumbnail videoUrl={record.videoUrl} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#111] group-hover:scale-105 transition-transform duration-500">
            <span className="text-3xl opacity-20 group-hover:opacity-30 transition-opacity">🎬</span>
          </div>
        )}
        {/* Status badge */}
        <div className="absolute top-2 right-2 z-10">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md border ${
              record.status === 'done'
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            {record.status === 'done' ? (isZh ? '成功' : 'Done') : (isZh ? '失败' : 'Error')}
          </span>
        </div>
        {/* Hover actions */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
          {record.videoUrl && record.status === 'done' && (
            <a
              href={`/api/video-proxy?url=${encodeURIComponent(record.videoUrl)}`}
              download
              onClick={(e) => e.stopPropagation()}
              className="p-2.5 bg-white/10 rounded-full hover:bg-white/20 hover:scale-110 transition-all border border-white/10"
              title={isZh ? '下载' : 'Download'}
            >
              <DownloadIcon className="w-4 h-4 text-white" />
            </a>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2.5 bg-white/10 rounded-full hover:bg-red-500/20 hover:text-red-400 hover:scale-110 transition-all border border-white/10"
            title={isZh ? '删除' : 'Delete'}
          >
            <TrashIcon className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
      {/* Info */}
      <div className="p-4 flex-1 flex flex-col">
        <p className="text-sm text-gray-200 truncate font-medium mb-auto">{record.prompt || (isZh ? '(无提示词)' : '(No prompt)')}</p>
        <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500 font-mono">
          <span className="bg-white/5 px-1.5 py-0.5 rounded">{record.model}</span>
          <span>{record.ratio}</span>
          <span>{record.duration}s</span>
        </div>
        <div className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-white/5 flex justify-between">
          <span>{new Date(record.createdAt).toLocaleDateString()}</span>
          <span>{new Date(record.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      </div>
    </div>
  );
}

/* ---- Drama Project Card ---- */
const STATUS_LABELS_ZH: Record<string, string> = {
  analyzing: '分析中', copyright_check: '待确认', copyright: '版权改造',
  character_confirm: '角色确认', scripting: '脚本生成', ready: '就绪',
  batch_generating: '生成中', batch_done: '已完成', batch_partial: '部分完成',
};
const STATUS_LABELS_EN: Record<string, string> = {
  analyzing: 'Analyzing', copyright_check: 'Review', copyright: 'Copyright',
  character_confirm: 'Characters', scripting: 'Scripting', ready: 'Ready',
  batch_generating: 'Generating', batch_done: 'Done', batch_partial: 'Partial',
};

function DramaCard({ project, isZh, onClick, onDelete }: { project: DramaProjectItem; isZh: boolean; onClick: () => void; onDelete: () => void }) {
  const statusColor = ['batch_done', 'ready'].includes(project.status)
    ? 'bg-green-500/10 border-green-500/20 text-green-400'
    : ['batch_generating', 'analyzing', 'scripting'].includes(project.status)
      ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
      : 'bg-blue-500/10 border-blue-500/20 text-blue-400';

  return (
    <div onClick={onClick}
      className="group bg-[#141414] border border-white/5 rounded-2xl overflow-hidden hover:border-green-500/30 hover:shadow-lg hover:shadow-green-900/10 transition-all duration-300 cursor-pointer relative flex flex-col h-full">
      <div className="aspect-video bg-[#111] flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <BookIcon className="w-10 h-10 text-green-500/20 group-hover:scale-110 transition-transform duration-500" />
        {/* 悬浮删除按钮 */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-3 bg-white/10 rounded-full hover:bg-red-500/20 hover:text-red-400 hover:scale-110 transition-all border border-white/10">
            <TrashIcon className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-2">
           <p className="text-sm text-gray-200 font-semibold line-clamp-1">{project.title}</p>
           <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${statusColor}`}>
            {(isZh ? STATUS_LABELS_ZH : STATUS_LABELS_EN)[project.status] || project.status}
          </span>
        </div>
        
        <div className="flex items-center gap-2 mt-auto text-[10px] text-gray-500 font-mono">
          <span className="bg-white/5 px-1.5 py-0.5 rounded">{project.style}</span>
          <span>{project.targetEpisodes}{isZh ? '集' : 'ep'}</span>
        </div>
        <div className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-white/5">
          {new Date(project.updatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

/* ---- Screenplay Project Card ---- */
const SP_STATUS_ZH: Record<string, string> = {
  config_done: '待生成方案', plan_done: '方案已生成', characters_done: '角色已开发',
  directory_done: '目录已生成', writing: '撰写中', review: '自检中', exported: '已导出',
};

function ScreenplayCard({ project, isZh, onClick, onDelete }: { project: ScreenplayProjectItem; isZh: boolean; onClick: () => void; onDelete: () => void }) {
  const isDone = project.status === 'exported';
  const isActive = ['writing', 'review', 'config_done', 'plan_done', 'characters_done', 'directory_done'].includes(project.status);
  const isWriting = ['writing', 'review'].includes(project.status);
  const statusColor = isDone 
    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
    : isWriting 
      ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' 
      : 'bg-blue-500/10 border-blue-500/20 text-blue-400';

  return (
    <div onClick={onClick}
      className={`group bg-[#141414] border rounded-2xl overflow-hidden hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-900/10 transition-all duration-300 cursor-pointer relative flex flex-col h-full ${isActive && !isDone ? 'border-blue-500/20' : 'border-white/5'}`}>
      <div className="aspect-video bg-[#111] flex items-center justify-center relative overflow-hidden">
         <div className="absolute inset-0 bg-gradient-to-br from-blue-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <BookIcon className="w-10 h-10 text-blue-500/20 group-hover:scale-110 transition-transform duration-500" />
        {isActive && !isDone && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[10px] text-blue-400 font-medium">{isZh ? '进行中' : 'Active'}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-3 bg-white/10 rounded-full hover:bg-red-500/20 hover:text-red-400 hover:scale-110 transition-all border border-white/10">
            <TrashIcon className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-2">
           <p className="text-sm text-gray-200 font-semibold line-clamp-1">{project.title}</p>
           <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${statusColor}`}>
            {isZh ? (SP_STATUS_ZH[project.status] || project.status) : project.status}
          </span>
        </div>
        
        <div className="flex items-center gap-2 mt-auto text-[10px] text-gray-500 font-mono">
          <span className="bg-white/5 px-1.5 py-0.5 rounded line-clamp-1 max-w-[50%]">{project.genres}</span>
          <span>{project.episodesWritten}/{project.totalEpisodes}{isZh ? '集' : 'ep'}</span>
        </div>
        <div className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-white/5">
          {new Date(project.updatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
