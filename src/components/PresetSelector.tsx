import { useTranslation } from 'react-i18next';
import type { PresetTemplate } from '../types';
import { DEFAULT_PRESETS } from '../types';

interface PresetSelectorProps {
  onSelect: (preset: PresetTemplate) => void;
}

export default function PresetSelector({ onSelect }: PresetSelectorProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  return (
    <div className="space-y-3">
      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
        {t('generate.presets')}
      </label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {DEFAULT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset)}
            className="group relative text-left px-4 py-3 rounded-xl border border-white/5 bg-[#111] hover:border-purple-500/30 hover:bg-purple-500/5 transition-all hover:shadow-lg hover:shadow-purple-900/10"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-200 group-hover:text-purple-300 transition-colors">{isEn ? preset.nameEn : preset.name}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
              <span className="bg-white/5 px-1.5 py-0.5 rounded">{preset.model === 'seedance-2.0' ? '2.0' : 'Fast'}</span>
              <span>{preset.ratio}</span>
              <span>{preset.duration}s</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
