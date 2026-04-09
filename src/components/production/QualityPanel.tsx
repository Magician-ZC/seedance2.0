// 质检面板：规则校验结果展示
import { useState } from 'react';
import * as api from '../../services/productionService';

interface Props {
  projectId: string;
  onRefresh: () => void;
}

interface QualityItem {
  rule: string;
  level: 'pass' | 'warning' | 'fail';
  message: string;
  episodeNumber?: number;
  shotIndex?: number;
}

interface QualityReport {
  totalChecks: number;
  passed: number;
  warnings: number;
  failures: number;
  items: QualityItem[];
  checkedAt: number;
}

export default function QualityPanel({ projectId }: Props) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pass' | 'warning' | 'fail'>('all');

  const handleCheck = async () => {
    setChecking(true);
    try {
      const data = await api.runQualityCheck(projectId);
      if (data?.report) setReport(data.report);
    } catch { /* ignore */ }
    setChecking(false);
  };

  const filtered = report?.items.filter(i => filter === 'all' || i.level === filter) || [];

  const levelConfig = {
    pass: { label: '通过', color: 'text-green-400', bg: 'bg-green-500/10', icon: 'M5 13l4 4L19 7' },
    warning: { label: '警告', color: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    fail: { label: '失败', color: 'text-red-400', bg: 'bg-red-500/10', icon: 'M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728' },
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-semibold text-white">质量检测</h3>
        <button
          onClick={handleCheck}
          disabled={checking}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-all"
        >
          {checking ? '检测中...' : '运行质检'}
        </button>
      </div>

      {report ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-white">{report.totalChecks}</div>
              <div className="text-[10px] text-gray-500 mt-1">检查项</div>
            </div>
            <div className="bg-green-500/5 border border-green-500/10 rounded-xl p-4 text-center cursor-pointer" onClick={() => setFilter('pass')}>
              <div className="text-2xl font-bold text-green-400">{report.passed}</div>
              <div className="text-[10px] text-green-400/60 mt-1">通过</div>
            </div>
            <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-xl p-4 text-center cursor-pointer" onClick={() => setFilter('warning')}>
              <div className="text-2xl font-bold text-yellow-400">{report.warnings}</div>
              <div className="text-[10px] text-yellow-400/60 mt-1">警告</div>
            </div>
            <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 text-center cursor-pointer" onClick={() => setFilter('fail')}>
              <div className="text-2xl font-bold text-red-400">{report.failures}</div>
              <div className="text-[10px] text-red-400/60 mt-1">失败</div>
            </div>
          </div>

          {/* Filter */}
          <div className="flex gap-1">
            {(['all', 'pass', 'warning', 'fail'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-lg text-[10px] font-medium transition-all ${
                  filter === f ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {f === 'all' ? '全部' : levelConfig[f].label} ({f === 'all' ? report.items.length : report.items.filter(i => i.level === f).length})
              </button>
            ))}
          </div>

          {/* Items */}
          <div className="space-y-2">
            {filtered.map((item, idx) => {
              const cfg = levelConfig[item.level];
              return (
                <div key={idx} className={`${cfg.bg} border border-white/5 rounded-xl px-4 py-3 flex items-start gap-3`}>
                  <svg className={`w-4 h-4 mt-0.5 ${cfg.color} flex-shrink-0`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d={cfg.icon} />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white">{item.rule}</span>
                      {item.episodeNumber && <span className="text-[10px] text-gray-500">第{item.episodeNumber}集</span>}
                      {item.shotIndex !== undefined && <span className="text-[10px] text-gray-500">镜头{item.shotIndex}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{item.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          点击「运行质检」检查项目状态
        </div>
      )}
    </div>
  );
}
