// 视觉风格选择器组件 - 可复用
import { useState } from 'react';
import { VISUAL_STYLE_PRESETS, getStyleById } from '../constants/visual-styles';

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
    '3d': '3D风格',
    '2d': '2D动画',
    'real': '真人风格',
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => !disabled && setShowPicker(!showPicker)}
        className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-sm text-left hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={disabled}
      >
        <div className="flex items-center justify-between">
          <span className="text-white">{selectedStyle?.name || '选择风格'}</span>
          <span className="text-gray-500">{showPicker ? '▲' : '▼'}</span>
        </div>
        {selectedStyle && (
          <p className="text-xs text-gray-500 mt-1">{selectedStyle.description}</p>
        )}
      </button>
      
      {showPicker && (
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowPicker(false)}
          />
          
          {/* 下拉面板 */}
          <div className="absolute top-full left-0 right-0 mt-2 bg-[#0e0e0e] border border-white/10 rounded-xl p-3 space-y-4 max-h-[400px] overflow-y-auto z-50 shadow-xl">
            {Object.entries(stylesByCategory).map(([category, styles]) => (
              styles.length > 0 && (
                <div key={category}>
                  <div className="text-xs text-gray-500 font-medium mb-2 px-2">
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
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          selectedStyleId === style.id
                            ? 'bg-green-600/20 border border-green-500/50'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="text-sm text-white">{style.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{style.description}</div>
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
