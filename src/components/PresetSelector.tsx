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
    <div className="bg-[#1c1f2e] rounded-2xl p-4 border border-gray-800">
      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-3">
        {t('generate.presets')}
      </label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {DEFAULT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset)}
            className="text-left px-3 py-2 rounded-lg border border-gray-700 bg-[#161824] hover:border-purple-500/50 hover:bg-purple-500/5 transition-all"
          >
            <div className="text-sm text-gray-300">{isEn ? preset.nameEn : preset.name}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {preset.model === 'seedance-2.0' ? '2.0' : 'Fast'} · {preset.ratio} · {preset.duration}s
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
