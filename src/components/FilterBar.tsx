// 通用筛选按钮组件 - 用于作者仓库和群演仓库的多维度筛选
interface FilterBarProps {
  items: { key: string; label: string; count: number }[];
  active: string | null;
  onSelect: (key: string | null) => void;
  allLabel?: string;
}

export default function FilterBar({ items, active, onSelect, allLabel = '全部' }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
      <button onClick={() => onSelect(null)}
        className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!active ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-gray-500 border border-transparent hover:text-gray-300 hover:bg-white/10'}`}>
        {allLabel}
      </button>
      {items.map(({ key, label, count }) => (
        <button key={key} onClick={() => onSelect(active === key ? null : key)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${active === key ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-gray-500 border border-transparent hover:text-gray-300 hover:bg-white/10'}`}>
          {label}
          <span className="text-[10px] opacity-60">{count}</span>
        </button>
      ))}
    </div>
  );
}
