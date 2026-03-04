import { useEffect, useRef } from 'react';
import type { Duration } from '../types';
import { DURATION_OPTIONS } from '../types';
import { ClockIcon } from './Icons';

interface DurationSelectorProps {
  value: Duration;
  onChange: (duration: Duration) => void;
  onClose: () => void;
}

export default function DurationSelector({ value, onChange, onClose }: DurationSelectorProps) {
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
      className="absolute bottom-full mb-2 right-0 bg-[#1c1f2e] border border-white/10 rounded-2xl p-2 shadow-2xl z-50 w-48 animate-fade-in"
    >
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-3 py-2">Select Duration</div>
      <div className="space-y-1">
        {DURATION_OPTIONS.map((d) => {
          const isSelected = d === value;
          return (
            <button
              key={d}
              onClick={() => {
                onChange(d);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                isSelected
                  ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                  : 'text-gray-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <ClockIcon className={`w-4 h-4 ${isSelected ? 'text-green-400' : 'text-gray-500'}`} />
              <span className="font-medium">{d}s</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
