import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type NavTab = 'works' | 'production' | 'materials' | 'characters' | 'arena' | 'authorAgents' | 'characterAgents' | 'systemAgents' | 'experiences';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TheaterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="9" cy="9" r="2" />
      <circle cx="15" cy="9" r="2" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function SwordsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M9.5 6.5L21 18v3h-3L6.5 9.5" />
      <path d="M11 5l-6 6" />
      <path d="M8 8L4 4" />
      <path d="M5 3L3 5" />
    </svg>
  );
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" />
      <path d="M10 21h4" />
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
      <path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
    </svg>
  );
}

// 顶级导航项

// 顶级导航项
function ClapperIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M7 4v16M17 4v16M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4M3 4h18v16H3z" />
    </svg>
  );
}

const TOP_NAV: { key: NavTab; icon: typeof GridIcon; labelZh: string; labelEn: string }[] = [
  { key: 'works', icon: GridIcon, labelZh: '我的作品', labelEn: 'My Works' },
  { key: 'production', icon: ClapperIcon, labelZh: '短剧制片', labelEn: 'Production' },
  { key: 'materials', icon: FolderIcon, labelZh: '素材', labelEn: 'Materials' },
  { key: 'characters', icon: UsersIcon, labelZh: '角色', labelEn: 'Characters' },
  { key: 'arena', icon: SwordsIcon, labelZh: '角斗场', labelEn: 'Arena' },
  { key: 'experiences', icon: BrainIcon, labelZh: '经验记忆', labelEn: 'Memory' },
];

// Agent仓库子菜单
const AGENT_SUB_NAV: { key: NavTab; icon: typeof GridIcon; labelZh: string; labelEn: string }[] = [
  { key: 'authorAgents', icon: PenIcon, labelZh: '作者仓库', labelEn: 'Author Agents' },
  { key: 'characterAgents', icon: TheaterIcon, labelZh: '群演仓库', labelEn: 'Cast Agents' },
  { key: 'systemAgents', icon: ShieldIcon, labelZh: '系统Agent', labelEn: 'System Agents' },
];

function BotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <circle cx="9" cy="14" r="1.5" fill="currentColor" />
      <circle cx="15" cy="14" r="1.5" fill="currentColor" />
      <path d="M12 2v4" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg className={`${className} transition-transform duration-200 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const isAgentTab = activeTab === 'authorAgents' || activeTab === 'characterAgents' || activeTab === 'systemAgents';
  const [agentExpanded, setAgentExpanded] = useState(isAgentTab);

  const renderNavButton = (key: NavTab, Icon: typeof GridIcon, labelZh: string, labelEn: string, indent = false) => {
    const isActive = activeTab === key;
    return (
      <button
        key={key}
        onClick={() => onTabChange(key)}
        className={`group relative w-full flex items-center gap-3 ${indent ? 'pl-8 pr-3' : 'px-3'} py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-white/10 text-white shadow-sm'
            : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
        }`}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-green-500 rounded-r-full opacity-0 md:opacity-100" />
        )}
        <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${isActive ? 'text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
        <span className="hidden md:block truncate">{isZh ? labelZh : labelEn}</span>
      </button>
    );
  };

  return (
    <aside className="w-[72px] md:w-[200px] flex-shrink-0 bg-[#0a0a0a] border-r border-white/5 flex flex-col h-full transition-all duration-300">
      {/* Logo */}
      <div className="h-16 flex items-center px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/20">
            <span className="text-white text-sm font-bold">S</span>
          </div>
          <span className="hidden md:block text-base font-bold text-white tracking-wide">Seedance</span>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-6 px-3 space-y-1.5">
        {TOP_NAV.map(({ key, icon: Icon, labelZh, labelEn }) =>
          renderNavButton(key, Icon, labelZh, labelEn)
        )}

        {/* Agent仓库 - 可展开的分组 */}
        <div>
          <button
            onClick={() => setAgentExpanded(!agentExpanded)}
            className={`group relative w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              isAgentTab
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <BotIcon className={`w-5 h-5 flex-shrink-0 transition-colors ${isAgentTab ? 'text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
            <span className="hidden md:block truncate flex-1 text-left">{isZh ? 'Agent仓库' : 'Agents'}</span>
            <ChevronIcon className="w-3.5 h-3.5 hidden md:block text-gray-600" open={agentExpanded} />
          </button>

          {agentExpanded && (
            <div className="mt-1 space-y-0.5 animate-fade-in">
              {AGENT_SUB_NAV.map(({ key, icon: Icon, labelZh, labelEn }) =>
                renderNavButton(key, Icon, labelZh, labelEn, true)
              )}
            </div>
          )}
        </div>
      </nav>
      
      {/* Footer / Version */}
      <div className="p-4 hidden md:block">
        <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/5">
          <p className="text-[10px] text-gray-500 font-mono">v2.0.0 Beta</p>
        </div>
      </div>
    </aside>
  );
}
