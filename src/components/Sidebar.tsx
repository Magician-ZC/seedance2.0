import { useTranslation } from 'react-i18next';

export type NavTab = 'works' | 'materials' | 'characters' | 'agents';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
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
    <aside className="w-[72px] md:w-[140px] flex-shrink-0 bg-[#0a0a0a] border-r border-white/5 flex flex-col h-full">
      {/* Logo */}
      <div className="h-14 flex items-center px-3 md:px-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-green-400 to-green-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">S</span>
          </div>
          <span className="hidden md:block text-sm font-semibold text-white">Seedance</span>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {NAV_ITEMS.map(({ key, icon: Icon, labelZh, labelEn }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`relative w-full flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {isActive && <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-green-500 rounded-r-full" />}
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span className="hidden md:block truncate">{isZh ? labelZh : labelEn}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
