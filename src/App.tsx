import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryRecord } from './services/historyService';
import Sidebar, { type NavTab } from './components/Sidebar';
import WorksPanel from './components/WorksPanel';
import VideoGenModal from './components/VideoGenModal';
import SettingsModal, { loadSettings } from './components/SettingsModal';
import SensitiveWordsPanel from './components/SensitiveWordsPanel';
import NovelToDrama from './components/NovelToDrama';
import ProjectWorkspace from './components/ProjectWorkspace';
import GlobalMaterialsPanel from './components/GlobalMaterialsPanel';
import GlobalCharactersPanel from './components/GlobalCharactersPanel';
import LanguageSwitch from './components/LanguageSwitch';
import { GearIcon, ShieldIcon } from './components/Icons';
import './i18n';

export default function App() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const [activeTab, setActiveTab] = useState<NavTab>('works');
  const [sessionId, setSessionId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showVideoGen, setShowVideoGen] = useState(false);
  const [showSensitiveWords, setShowSensitiveWords] = useState(false);
  const [showNovelToDrama, setShowNovelToDrama] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

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
        <div className="h-screen flex overflow-hidden bg-[#0a0a0a] text-white">
          <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1 flex flex-col min-w-0">
            {/* Top Bar */}
            <header className="h-14 flex items-center justify-between px-4 md:px-8 border-b border-white/5 flex-shrink-0">
              <h1 className="text-base font-semibold text-white">
                {activeTab === 'works'
                  ? (isZh ? '我的作品' : 'My Works')
                  : activeTab === 'materials'
                    ? (isZh ? '素材' : 'Materials')
                    : (isZh ? '角色' : 'Characters')}
              </h1>
              <div className="flex items-center gap-1">
                <LanguageSwitch />
                <button onClick={() => setShowSensitiveWords(true)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
                  title={isZh ? '敏感词' : 'Filter'}>
                  <ShieldIcon className="w-4 h-4" />
                </button>
                <button onClick={() => setShowSettings(true)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
                  title={isZh ? '设置' : 'Settings'}>
                  <GearIcon className="w-4 h-4" />
                </button>
              </div>
            </header>

            {activeTab === 'works' && (
              <WorksPanel
                onNewProject={() => setShowNovelToDrama(true)}
                onOpenNovelToDrama={() => setShowNovelToDrama(true)}
                onOpenVideoGen={() => setShowVideoGen(true)}
                onSelectHistory={handleHistorySelect}
                onOpenProject={(projectId: string) => setActiveProjectId(projectId)}
              />
            )}
            {activeTab === 'materials' && (
              <GlobalMaterialsPanel />
            )}
            {activeTab === 'characters' && (
              <GlobalCharactersPanel />
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
        </div>
      )}
    </>
  );
}

