// 视觉风格选择器组件 - 可复用
import { useState } from 'react';
import { VISUAL_STYLE_PRESETS, getStyleById } from '../constants/visual-styles';
import { ChevronDownIcon } from './Icons';

interface StylePickerProps {
  selectedStyleId: string;
  onStyleChange: (styleId: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function StylePicker({ 
  selectedStyleId, 
  onStyleChange, 
  disabled = false,
  className = '' 
}: StylePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const selectedStyle = getStyleById(selectedStyleId);

  // 按分类分组
  const stylesByCategory = {
    '3d': VISUAL_STYLE_PRESETS.filter(s => s.category === '3d'),
    '2d': VISUAL_STYLE_PRESETS.filter(s => s.category === '2d'),
    'real': VISUAL_STYLE_PRESETS.filter(s => s.category === 'real'),
  };

  const categoryLabels = {
    '3d': '3D 风格',
    '2d': '2D 动画',
    'real': '真人风格',
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => !disabled && setShowPicker(!showPicker)}
        className="w-full bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-left hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
        disabled={disabled}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-white group-hover:text-green-400 transition-colors">{selectedStyle?.name || '选择风格'}</span>
          <ChevronDownIcon className={`w-3 h-3 text-gray-500 transition-transform duration-300 ${showPicker ? 'rotate-180' : ''}`} />
        </div>
        {selectedStyle && (
          <p className="text-[10px] text-gray-500 truncate">{selectedStyle.description}</p>
        )}
      </button>
      
      {showPicker && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowPicker(false)}
          />
          
          <div className="absolute top-full left-0 right-0 mt-2 bg-[#1c1f2e] border border-white/10 rounded-2xl p-2 space-y-4 max-h-[400px] overflow-y-auto z-50 shadow-2xl animate-fade-in custom-scrollbar">
            {Object.entries(stylesByCategory).map(([category, styles]) => (
              styles.length > 0 && (
                <div key={category} className="px-1">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 px-2 pt-2 sticky top-0 bg-[#1c1f2e] z-10">
                    {categoryLabels[category as keyof typeof categoryLabels]}
                  </div>
                  <div className="space-y-1">
                    {styles.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => {
                          onStyleChange(style.id);
                          setShowPicker(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all group ${
                          selectedStyleId === style.id
                            ? 'bg-green-600/20 border border-green-500/30'
                            : 'hover:bg-white/5 border border-transparent'
                        }`}
                      >
                        <div className={`text-sm font-medium ${selectedStyleId === style.id ? 'text-green-400' : 'text-gray-300 group-hover:text-white'}`}>{style.name}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5 truncate group-hover:text-gray-400">{style.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </>
      )}
    </div>
  );
}
