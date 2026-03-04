import { useState } from 'react';
import type { AspectRatio, Duration, ReferenceMode } from '../types';
import { REFERENCE_MODES } from '../types';
import { VideoIcon, SparkleIcon, ChevronDownIcon, ClockIcon, SendIcon, SpinnerIcon, RatioIcon } from './Icons';
import RatioSelector from './RatioSelector';
import DurationSelector from './DurationSelector';

interface ToolbarProps {
  ratio: AspectRatio;
  onRatioChange: (ratio: AspectRatio) => void;
  duration: Duration;
  onDurationChange: (duration: Duration) => void;
  referenceMode: ReferenceMode;
  onReferenceModeChange: (mode: ReferenceMode) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

export default function Toolbar({
  ratio,
  onRatioChange,
  duration,
  onDurationChange,
  referenceMode,
  onReferenceModeChange,
  onGenerate,
  isGenerating,
}: ToolbarProps) {
  const [showRatio, setShowRatio] = useState(false);
  const [showDuration, setShowDuration] = useState(false);
  const [showMode, setShowMode] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap bg-[#111]/80 backdrop-blur-sm p-2 rounded-2xl border border-white/5">
      {/* Video Generation label */}
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-cyan-500/20">
        <VideoIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">视频生成</span>
      </div>

      {/* Seedance 2.0 badge */}
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 text-purple-400 text-xs font-medium border border-purple-500/20">
        <SparkleIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Seedance 2.0</span>
      </div>

      <div className="w-px h-6 bg-white/10 mx-1"></div>

      {/* Reference mode selector */}
      <div className="relative">
        <button
          onClick={() => {
            setShowMode(!showMode);
            setShowRatio(false);
            setShowDuration(false);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a1a] hover:bg-[#222] text-gray-300 text-xs font-medium border border-white/5 hover:border-white/10 transition-all"
        >
          <span>{referenceMode}</span>
          <ChevronDownIcon className={`w-3 h-3 transition-transform ${showMode ? 'rotate-180' : ''}`} />
        </button>

        {showMode && (
          <div className="absolute bottom-full mb-2 left-0 bg-[#1c1f2e] border border-white/10 rounded-xl p-2 shadow-xl z-50 w-40 animate-fade-in">
            {REFERENCE_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  onReferenceModeChange(mode);
                  setShowMode(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  mode === referenceMode
                    ? 'bg-cyan-600/20 text-cyan-400'
                    : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Aspect ratio selector */}
      <div className="relative">
        <button
          onClick={() => {
            setShowRatio(!showRatio);
            setShowDuration(false);
            setShowMode(false);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a1a] hover:bg-[#222] text-gray-300 text-xs font-medium border border-white/5 hover:border-white/10 transition-all"
        >
          <RatioIcon className="w-3.5 h-3.5" />
          <span>{ratio}</span>
        </button>

        {showRatio && (
          <RatioSelector
            value={ratio}
            onChange={onRatioChange}
            onClose={() => setShowRatio(false)}
          />
        )}
      </div>

      {/* Duration selector */}
      <div className="relative">
        <button
          onClick={() => {
            setShowDuration(!showDuration);
            setShowRatio(false);
            setShowMode(false);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a1a] hover:bg-[#222] text-gray-300 text-xs font-medium border border-white/5 hover:border-white/10 transition-all"
        >
          <ClockIcon className="w-3.5 h-3.5" />
          <span>{duration}s</span>
        </button>

        {showDuration && (
          <DurationSelector
            value={duration}
            onChange={onDurationChange}
            onClose={() => setShowDuration(false)}
          />
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-900/20 hover:scale-105 active:scale-95"
      >
        {isGenerating ? (
          <SpinnerIcon className="w-5 h-5 text-white" />
        ) : (
          <SendIcon className="w-5 h-5 text-white" />
        )}
      </button>
    </div>
  );
}
