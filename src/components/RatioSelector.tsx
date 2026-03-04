import { useEffect, useRef } from 'react';
import type { AspectRatio } from '../types';
import { RATIO_OPTIONS } from '../types';

interface RatioSelectorProps {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
  onClose: () => void;
}

export default function RatioSelector({ value, onChange, onClose }: RatioSelectorProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 bg-[#1c1f2e] border border-white/10 rounded-2xl p-4 shadow-2xl z-50 min-w-[340px] animate-fade-in"
    >
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Select Aspect Ratio</div>
      <div className="grid grid-cols-6 gap-2">
        {RATIO_OPTIONS.map((opt) => {
          const isSelected = opt.value === value;
          const maxDim = 28;
          const scale = maxDim / Math.max(opt.widthRatio, opt.heightRatio);
          const w = Math.round(opt.widthRatio * scale);
          const h = Math.round(opt.heightRatio * scale);

          return (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                onClose();
              }}
              className={`group flex flex-col items-center gap-2 p-2 rounded-xl transition-all ${
                isSelected
                  ? 'bg-green-600/20 ring-1 ring-green-500/50'
                  : 'hover:bg-white/5 border border-transparent hover:border-white/5'
              }`}
            >
              <div className="flex items-center justify-center w-10 h-10 bg-black/20 rounded-lg group-hover:bg-black/40 transition-colors">
                <div
                  className={`rounded-[2px] border ${
                    isSelected ? 'border-green-400 bg-green-400/20' : 'border-gray-500 group-hover:border-gray-300'
                  }`}
                  style={{ width: `${w}px`, height: `${h}px` }}
                />
              </div>
              <span
                className={`text-[10px] font-medium ${
                  isSelected ? 'text-green-400' : 'text-gray-500 group-hover:text-gray-300'
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
