// 后台运行浮动指示器 - 通用组件
import { type ReactNode } from 'react';

export interface BackgroundStatus {
  step: string;
  stepLabel: string;
  loading: boolean;
  projectTitle?: string;
}

interface BackgroundIndicatorProps {
  status: BackgroundStatus;
  icon: ReactNode;
  defaultTitle: string;
  onClick: () => void;
}

export default function BackgroundIndicator({ status, icon, defaultTitle, onClick }: BackgroundIndicatorProps) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#1a1a1a]/95 backdrop-blur border border-white/10 shadow-2xl shadow-black/50 cursor-pointer hover:border-green-500/30 hover:scale-[1.02] transition-all group"
    >
      {status.loading ? (
        <div className="w-5 h-5 border-2 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
      ) : (
        <span className="text-lg">{icon}</span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-white truncate max-w-[180px]">
          {status.projectTitle || defaultTitle}
        </div>
        <div className="text-[10px] text-gray-500">
          {status.loading ? `${status.stepLabel} 进行中...` : status.stepLabel}
        </div>
      </div>
      <span className="text-[10px] text-gray-600 group-hover:text-green-400 transition-colors ml-1">点击恢复</span>
    </div>
  );
}
