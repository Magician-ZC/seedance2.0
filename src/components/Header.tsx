import { useTranslation } from 'react-i18next';
import { GearIcon, ShieldIcon } from './Icons';
import LanguageSwitch from './LanguageSwitch';

interface HeaderProps {
  activeTab: string;
  onOpenSettings: () => void;
  onOpenSensitiveWords: () => void;
}

export default function Header({ activeTab, onOpenSettings, onOpenSensitiveWords }: HeaderProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const getTitle = () => {
    switch (activeTab) {
      case 'works': return isZh ? '我的作品' : 'My Works';
      case 'materials': return isZh ? '素材' : 'Materials';
      case 'agents': return isZh ? 'Agent仓库' : 'Agent Store';
      case 'characters': return isZh ? '角色' : 'Characters';
      default: return '';
    }
  };

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-[#0a0a0a]/50 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white tracking-tight">
          {getTitle()}
        </h1>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="h-8 w-[1px] bg-white/10 mx-1" />
        
        <LanguageSwitch />
        
        <button 
          onClick={onOpenSensitiveWords}
          className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-200"
          title={isZh ? '敏感词' : 'Filter'}
        >
          <ShieldIcon className="w-5 h-5" />
        </button>
        
        <button 
          onClick={onOpenSettings}
          className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-200"
          title={isZh ? '设置' : 'Settings'}
        >
          <GearIcon className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
