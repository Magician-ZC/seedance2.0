import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryRecord } from './services/historyService';
import Sidebar, { type NavTab } from './components/Sidebar';
import Header from './components/Header';
import WorksPanel from './components/WorksPanel';
import VideoGenModal from './components/VideoGenModal';
import SettingsModal, { loadSettings } from './components/SettingsModal';
import SensitiveWordsPanel from './components/SensitiveWordsPanel';
import NovelToDrama from './components/NovelToDrama';
import ScreenplayCreator from './components/ScreenplayCreator';
import AgentFactory from './components/AgentFactory';
import ProjectWorkspace from './components/ProjectWorkspace';
import GlobalMaterialsPanel from './components/GlobalMaterialsPanel';
import GlobalCharactersPanel from './components/GlobalCharactersPanel';
import AgentStorePanel from './components/AgentStorePanel';
import CharacterAgentPanel from './components/CharacterAgentPanel';
import ArenaPanel from './components/ArenaPanel';
import SystemAgentPanel from './components/SystemAgentPanel';
import BackgroundIndicator, { type BackgroundStatus } from './components/BackgroundIndicator';
import './i18n';

// 工厂后台运行项目信息
interface RunningProject {
  id: string;
  title: string;
  status: string;
  genre?: string;
  bestScore?: number;
}

export default function App() {
  useTranslation(); // 初始化 i18n

  const [activeTab, setActiveTab] = useState<NavTab>('works');
  const [sessionId, setSessionId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showVideoGen, setShowVideoGen] = useState(false);
  const [showSensitiveWords, setShowSensitiveWords] = useState(false);
  const [showNovelToDrama, setShowNovelToDrama] = useState(false);
  const [showScreenplayCreator, setShowScreenplayCreator] = useState(false);
  const [screenplayMinimized, setScreenplayMinimized] = useState(false);
  const [screenplayStatus, setScreenplayStatus] = useState<BackgroundStatus | null>(null);
  const [showAgentFactory, setShowAgentFactory] = useState(false);
  const [factoryMinimized, setFactoryMinimized] = useState(false);
  const [factoryStatus, setFactoryStatus] = useState<BackgroundStatus | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [screenplayProjectId, setScreenplayProjectId] = useState<string | null>(null);
  // 工厂：要恢复的项目 ID（从浮动指示器点击传入）
  const [factoryResumeId, setFactoryResumeId] = useState<string | null>(null);
  // 工厂：后台运行中的项目列表（用于浮动指示器）
  const [factoryRunningProjects, setFactoryRunningProjects] = useState<RunningProject[]>([]);
  // 剧本：后台运行中的项目列表（用于浮动指示器）
  const [screenplayRunningProjects, setScreenplayRunningProjects] = useState<RunningProject[]>([]);

  // 组件是否存活（显示或后台运行中）
  const screenplayAlive = showScreenplayCreator || screenplayMinimized;
  const factoryAlive = showAgentFactory || factoryMinimized;

  useEffect(() => {
    const saved = loadSettings();
    if (saved.sessionId) setSessionId(saved.sessionId);
    const envSessionId = import.meta.env.VITE_DEFAULT_SESSION_ID;
    if (!saved.sessionId && !envSessionId) setShowSettings(true);
  }, []);

  // 轮询获取工厂后台运行中的项目（仅在工厂最小化时）
  const fetchFactoryRunning = useCallback(() => {
    fetch('/api/factory/list').then(r => r.json()).then(data => {
      if (data?.projects) {
        const running = data.projects
          .filter((p: { status: string }) => p.status === 'evolving' || p.status === 'parsing')
          .map((p: { id: string; title: string; status: string; genre: string; bestScore: number }) => ({
            id: p.id, title: p.title, status: p.status, genre: p.genre, bestScore: p.bestScore,
          }));
        setFactoryRunningProjects(running);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!factoryMinimized || showAgentFactory) return;
    fetchFactoryRunning();
    const timer = setInterval(fetchFactoryRunning, 8000);
    return () => clearInterval(timer);
  }, [factoryMinimized, showAgentFactory, fetchFactoryRunning]);

  // 轮询获取剧本后台运行中的项目（仅在剧本最小化时）
  const fetchScreenplayRunning = useCallback(() => {
    fetch('/api/screenplay/list').then(r => r.json()).then(data => {
      if (data?.projects) {
        const running = data.projects
          .filter((p: { status: string }) => p.status !== 'exported')
          .map((p: { id: string; selectedTitle?: string; status: string; config?: { genres?: string[] } }) => ({
            id: p.id,
            title: p.selectedTitle || p.config?.genres?.join('+') || '未命名剧本',
            status: p.status,
          }));
        setScreenplayRunningProjects(running);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!screenplayMinimized || showScreenplayCreator) return;
    fetchScreenplayRunning();
    const timer = setInterval(fetchScreenplayRunning, 8000);
    return () => clearInterval(timer);
  }, [screenplayMinimized, showScreenplayCreator, fetchScreenplayRunning]);

  const handleHistorySelect = (_record: HistoryRecord) => {
    setShowVideoGen(true);
  };

  return (
    <>
      {/* 全屏项目工作台 */}
      {activeProjectId && (
        <ProjectWorkspace
          projectId={activeProjectId}
          sessionId={sessionId}
          onBack={() => setActiveProjectId(null)}
        />
      )}

      {/* 主页布局 */}
      {!activeProjectId && (
        <div className="h-screen flex overflow-hidden bg-[#0a0a0a] text-white selection:bg-green-500/30 selection:text-green-200">
          <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-br from-[#0a0a0a] to-[#111]">
            <Header 
              activeTab={activeTab}
              onOpenSettings={() => setShowSettings(true)}
              onOpenSensitiveWords={() => setShowSensitiveWords(true)}
            />

            {activeTab === 'works' && (
              <WorksPanel
                onNewProject={() => setShowNovelToDrama(true)}
                onOpenNovelToDrama={() => setShowNovelToDrama(true)}
                onOpenVideoGen={() => setShowVideoGen(true)}
                onOpenScreenplayCreator={() => { setShowScreenplayCreator(true); setScreenplayMinimized(false); }}
                onOpenAgentFactory={() => { setShowAgentFactory(true); setFactoryMinimized(false); }}
                onSelectHistory={handleHistorySelect}
                onOpenProject={(projectId: string) => setActiveProjectId(projectId)}
                onOpenScreenplayProject={(id: string) => { setScreenplayProjectId(id); setShowScreenplayCreator(true); setScreenplayMinimized(false); }}
              />
            )}
            {activeTab === 'materials' && (
              <GlobalMaterialsPanel />
            )}
            {activeTab === 'characters' && (
              <GlobalCharactersPanel />
            )}
            {activeTab === 'authorAgents' && (
              <AgentStorePanel />
            )}
            {activeTab === 'characterAgents' && (
              <CharacterAgentPanel />
            )}
            {activeTab === 'systemAgents' && (
              <SystemAgentPanel />
            )}
            {activeTab === 'arena' && (
              <ArenaPanel />
            )}
          </div>

          {/* Modals */}
          <VideoGenModal isOpen={showVideoGen} onClose={() => setShowVideoGen(false)} sessionId={sessionId} />
          <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} sessionId={sessionId} onSessionIdChange={setSessionId} />
          {showSensitiveWords && <SensitiveWordsPanel onClose={() => setShowSensitiveWords(false)} />}
          {showNovelToDrama && (
            <NovelToDrama
              onClose={() => setShowNovelToDrama(false)}
              sessionId={sessionId}
              onProjectCreated={(projectId) => { setShowNovelToDrama(false); setActiveProjectId(projectId); }}
            />
          )}
          {screenplayAlive && (
            <ScreenplayCreator
              onClose={() => { setShowScreenplayCreator(false); setScreenplayMinimized(false); setScreenplayProjectId(null); setScreenplayStatus(null); }}
              onMinimize={() => { setShowScreenplayCreator(false); setScreenplayMinimized(true); }}
              onProjectCreated={(projectId) => { setShowScreenplayCreator(false); setScreenplayMinimized(false); setScreenplayProjectId(null); setScreenplayStatus(null); setActiveProjectId(projectId); }}
              onStatusChange={setScreenplayStatus}
              resumeProjectId={screenplayProjectId}
              hidden={screenplayMinimized && !showScreenplayCreator}
            />
          )}
          {factoryAlive && (
            <AgentFactory
              onClose={() => { setShowAgentFactory(false); setFactoryMinimized(false); setFactoryStatus(null); setFactoryResumeId(null); }}
              onMinimize={() => { setShowAgentFactory(false); setFactoryMinimized(true); setFactoryResumeId(null); }}
              onStatusChange={setFactoryStatus}
              hidden={factoryMinimized && !showAgentFactory}
              resumeProjectId={factoryResumeId}
            />
          )}

          {/* 后台运行浮动指示器 */}
          <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
            {/* 剧本：最小化时显示所有进行中的项目 */}
            {screenplayMinimized && !showScreenplayCreator && screenplayRunningProjects.map(sp => (
              <BackgroundIndicator
                key={sp.id}
                status={{ step: sp.status, stepLabel: sp.status === 'writing' ? '分集撰写' : sp.status === 'review' ? '质量自检' : '创作中', loading: true, projectTitle: sp.title }}
                icon="✍️"
                defaultTitle="剧本创作"
                onClick={() => { setScreenplayProjectId(sp.id); setShowScreenplayCreator(true); setScreenplayMinimized(false); }}
              />
            ))}
            {/* 剧本最小化但没有进行中项目时，仍显示通用指示器 */}
            {screenplayMinimized && !showScreenplayCreator && screenplayRunningProjects.length === 0 && screenplayStatus && (
              <BackgroundIndicator
                status={screenplayStatus}
                icon="✍️"
                defaultTitle="剧本创作"
                onClick={() => { setShowScreenplayCreator(true); setScreenplayMinimized(false); }}
              />
            )}
            {/* 工厂：最小化时显示所有后台进化中的项目 */}
            {factoryMinimized && !showAgentFactory && factoryRunningProjects.map(fp => (
              <BackgroundIndicator
                key={fp.id}
                status={{ step: 'evolving', stepLabel: '进化竞赛', loading: true, projectTitle: fp.title }}
                icon="🧬"
                defaultTitle="创作工厂"
                onClick={() => { setFactoryResumeId(fp.id); setShowAgentFactory(true); setFactoryMinimized(false); }}
              />
            ))}
            {/* 工厂最小化但没有进化中项目时，仍显示通用指示器 */}
            {factoryMinimized && !showAgentFactory && factoryRunningProjects.length === 0 && factoryStatus && (
              <BackgroundIndicator
                status={factoryStatus}
                icon="🧬"
                defaultTitle="创作工厂"
                onClick={() => { setShowAgentFactory(true); setFactoryMinimized(false); }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
