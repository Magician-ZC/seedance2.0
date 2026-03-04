import { useTranslation } from 'react-i18next';

export default function LanguageSwitch() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');

  const toggle = () => {
    i18n.changeLanguage(isZh ? 'en' : 'zh');
  };

  return (
    <button
      onClick={toggle}
      className="px-3 py-1.5 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-200 border border-transparent hover:border-white/5"
      title={isZh ? 'Switch to English' : '切换到中文'}
    >
      {isZh ? 'EN' : '中'}
    </button>
  );
}
