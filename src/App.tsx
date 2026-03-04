import { useState, useEffect } from 'react';
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
import './i18n';

export default function App() {
  useTranslation(); // 初始化 i18n

  const [activeTab, setActiveTab] = useState<NavTab>('works');
  const [sessionId, setSessionId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showVideoGen, setShowVideoGen] = useState(false);
  const [showSensitiveWords, setShowSensitiveWords] = useState(false);
  const [showNovelToDrama, setShowNovelToDrama] = useState(false);
  const [showScreenplayCreator, setShowScreenplayCreator] = useState(false);
  const [showAgentFactory, setShowAgentFactory] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [screenplayProjectId, setScreenplayProjectId] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadSettings();
    if (saved.sessionId) setSessionId(saved.sessionId);
    const envSessionId = import.meta.env.VITE_DEFAULT_SESSION_ID;
    if (!saved.sessionId && !envSessionId) setShowSettings(true);
  }, []);

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
                onOpenScreenplayCreator={() => setShowScreenplayCreator(true)}
                onOpenAgentFactory={() => setShowAgentFactory(true)}
                onSelectHistory={handleHistorySelect}
                onOpenProject={(projectId: string) => setActiveProjectId(projectId)}
                onOpenScreenplayProject={(id: string) => { setScreenplayProjectId(id); setShowScreenplayCreator(true); }}
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
          {showScreenplayCreator && (
            <ScreenplayCreator
              onClose={() => { setShowScreenplayCreator(false); setScreenplayProjectId(null); }}
              onProjectCreated={(projectId) => { setShowScreenplayCreator(false); setScreenplayProjectId(null); setActiveProjectId(projectId); }}
              resumeProjectId={screenplayProjectId}
            />
          )}
          {showAgentFactory && (
            <AgentFactory onClose={() => setShowAgentFactory(false)} />
          )}
        </div>
      )}
    </>
  );
}
