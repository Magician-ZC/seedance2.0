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
      className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
      title={isZh ? 'Switch to English' : '切换到中文'}
    >
      {isZh ? 'EN' : '中'}
    </button>
  );
}
