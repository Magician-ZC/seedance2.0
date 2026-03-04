import { useTranslation } from 'react-i18next';

export type NavTab = 'works' | 'materials' | 'characters' | 'agents';

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

const NAV_ITEMS: { key: NavTab; icon: typeof GridIcon; labelZh: string; labelEn: string }[] = [
  { key: 'works', icon: GridIcon, labelZh: '我的作品', labelEn: 'My Works' },
  { key: 'materials', icon: FolderIcon, labelZh: '素材', labelEn: 'Materials' },
  { key: 'characters', icon: UsersIcon, labelZh: '角色', labelEn: 'Characters' },
  { key: 'agents', icon: BotIcon, labelZh: 'Agent仓库', labelEn: 'Agents' },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

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
        {NAV_ITEMS.map(({ key, icon: Icon, labelZh, labelEn }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`group relative w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
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
        })}
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
