// 制片工作台 - 主容器，包含Tab切换
import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../../services/productionService';
import type { ProductionWorkspaceTab } from '../../types/production';
import { statusToDefaultProductionTab } from '../../types/production';
import ScriptPanel from './ScriptPanel';
import AssetPanel from './AssetPanel';
import VoicePanel from './VoicePanel';
import TimelinePanel from './TimelinePanel';
import QualityPanel from './QualityPanel';

interface Props {
  projectId: string;
  sessionId: string;
  onBack: () => void;
}

interface ProjectData {
  project: { id: string; title: string; status: string; totalEpisodes: number; config: Record<string, unknown>; requirementsText: string };
  episodes: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  voices: Array<Record<string, unknown>>;
}

interface RunningTaskInfo {
  taskId: string;
  stage: string;
  progress: string;
  status: string;
}

const TABS: { key: ProductionWorkspaceTab; label: string; icon: string }[] = [
  { key: 'script', label: '分镜脚本', icon: 'M9 12h6M9 16h6M5 8h14M5 4h14v16H5z' },
  { key: 'assets', label: '资产管理', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M12 7a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { key: 'voice', label: '配音管理', icon: 'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8' },
  { key: 'timeline', label: '时间线', icon: 'M7 4v16M17 4v16M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4M3 4h18v16H3z' },
  { key: 'quality', label: '质检', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
];

const STAGE_LABELS: Record<string, string> = {
  clean: '脚本清洗', extract: '资产提取', voice: '配音生成', video: '视频生成',
};

export default function ProductionWorkspace({ projectId, sessionId, onBack }: Props) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<ProductionWorkspaceTab>('script');
  const [loading, setLoading] = useState(true);
  const [runningTasks, setRunningTasks] = useState<RunningTaskInfo[]>([]);

  const initialLoadDone = useRef(false);
  const loadProject = useCallback(async () => {
    try {
      const result = await api.getProductionProject(projectId);
      if (result?.project) {
        setData(result as ProjectData);
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          setActiveTab(statusToDefaultProductionTab(result.project.status));
          setLoading(false);
        }
      }
    } catch { setLoading(false); }
  }, [projectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // 轮询当前项目的运行中任务，任务完成时自动刷新数据
  const prevRunningRef = useRef<string[]>([]);
  useEffect(() => {
    const fetchTasks = () => {
      api.getProjectTasks(projectId).then(res => {
        if (!res?.tasks) return;
        const allTasks = res.tasks as RunningTaskInfo[];
        const nowRunning = allTasks.filter((t) => t.status === 'running');
        setRunningTasks(nowRunning);

        const nowRunningIds = new Set(nowRunning.map((t) => t.taskId));
        const prevIds = prevRunningRef.current;
        const justFinished = prevIds.filter((id) => !nowRunningIds.has(id));
        if (justFinished.length > 0) {
          loadProject();
        }
        prevRunningRef.current = nowRunning.map((t) => t.taskId);
      }).catch(() => {});
    };
    fetchTasks();
    const timer = setInterval(fetchTasks, 4000);
    return () => clearInterval(timer);
  }, [projectId, loadProject]);

  if (loading || !data) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-50 flex flex-col">
      {/* Top Bar */}
      <div className="h-14 flex items-center px-4 border-b border-white/5 bg-[#0a0a0a]">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mr-4">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          返回主界面
        </button>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M7 4v16M17 4v16M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4M3 4h18v16H3z" />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">{data.project.title}</span>
          <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-md">{data.project.totalEpisodes}集</span>
          {/* 运行中任务小标签 */}
          {runningTasks.map(t => (
            <span key={t.taskId} className="flex items-center gap-1.5 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              {STAGE_LABELS[t.stage] || t.stage}: {t.progress}
            </span>
          ))}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="h-11 flex items-center px-4 gap-1 border-b border-white/5 bg-[#0a0a0a]">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-white/10 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d={tab.icon} /></svg>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'script' && (
          <ScriptPanel projectId={projectId} episodes={data.episodes} onRefresh={loadProject} />
        )}
        {activeTab === 'assets' && (
          <AssetPanel projectId={projectId} assets={data.assets} onRefresh={loadProject} sessionId={sessionId} />
        )}
        {activeTab === 'voice' && (
          <VoicePanel projectId={projectId} assets={data.assets} voices={data.voices} onRefresh={loadProject} />
        )}
        {activeTab === 'timeline' && (
          <TimelinePanel projectId={projectId} sessionId={sessionId} episodes={data.episodes} assets={data.assets} onRefresh={loadProject} />
        )}
        {activeTab === 'quality' && (
          <QualityPanel projectId={projectId} onRefresh={loadProject} />
        )}
      </div>
    </div>
  );
}
