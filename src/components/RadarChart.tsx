// 六维度雷达图组件 - 支持多数据集叠加与角色视图切换
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DimensionScores } from '../../server/src/arena-types';

// 六维度键名顺序
const DIMENSION_KEYS: (keyof DimensionScores)[] = [
  'plotStructure',
  'characterization',
  'dialogueQuality',
  'pacing',
  'creativity',
  'commercialPotential',
];

export interface RadarDataset {
  label: string;
  color: string;
  scores: DimensionScores;
}

interface RadarChartProps {
  datasets: RadarDataset[];
  size?: number;
  showLabels?: boolean;
  showLegend?: boolean;
}

// 计算六边形顶点坐标
function polarToCartesian(cx: number, cy: number, r: number, index: number): [number, number] {
  const angle = (Math.PI * 2 * index) / 6 - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

// 生成多边形 points 字符串
function buildPolygonPoints(cx: number, cy: number, r: number, scores: number[]): string {
  return scores
    .map((val, i) => {
      const [x, y] = polarToCartesian(cx, cy, r * (val / 10), i);
      return `${x},${y}`;
    })
    .join(' ');
}

export default function RadarChart({ datasets, size = 300, showLabels = true, showLegend = true }: RadarChartProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null); // null = 综合叠加
  const [tooltip, setTooltip] = useState<{ x: number; y: number; dim: string; values: { label: string; color: string; score: number }[] } | null>(null);

  const cx = 150, cy = 150, maxR = 120;
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  // 当前显示的数据集
  const visibleDatasets = activeIndex !== null ? [datasets[activeIndex]] : datasets;

  // 维度标签
  const dimensionLabels = DIMENSION_KEYS.map(key => t(`arena.dimensions.${key}`));

  // 处理维度顶点 hover
  const handleDimHover = (e: React.MouseEvent<SVGCircleElement>, dimIndex: number) => {
    const svgRect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect();
    if (!svgRect) return;
    const values = visibleDatasets.map(ds => ({
      label: ds.label,
      color: ds.color,
      score: ds.scores[DIMENSION_KEYS[dimIndex]],
    }));
    setTooltip({
      x: e.clientX - svgRect.left,
      y: e.clientY - svgRect.top - 10,
      dim: dimensionLabels[dimIndex],
      values,
    });
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {/* 视图切换按钮 */}
      {datasets.length > 1 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          <button
            onClick={() => setActiveIndex(null)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              activeIndex === null
                ? 'bg-white/10 border-white/20 text-white'
                : 'border-white/5 text-white/40 hover:text-white/60 hover:border-white/10'
            }`}
          >
            {t('arena.reviewMode.panel')}
          </button>
          {datasets.map((ds, i) => (
            <button
              key={ds.label}
              onClick={() => setActiveIndex(i)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                activeIndex === i
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'border-white/5 text-white/40 hover:text-white/60 hover:border-white/10'
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: ds.color }} />
              {ds.label}
            </button>
          ))}
        </div>
      )}

      {/* SVG 雷达图 */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 300 300"
          width={size}
          height={size}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* 背景网格 */}
          {gridLevels.map(scale => (
            <polygon
              key={scale}
              points={Array.from({ length: 6 }, (_, i) => {
                const [x, y] = polarToCartesian(cx, cy, maxR * scale, i);
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="white"
              strokeOpacity={0.08}
              strokeWidth={0.5}
            />
          ))}

          {/* 轴线 */}
          {Array.from({ length: 6 }, (_, i) => {
            const [x, y] = polarToCartesian(cx, cy, maxR, i);
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="white" strokeOpacity={0.06} strokeWidth={0.5} />;
          })}

          {/* 数据多边形 */}
          {visibleDatasets.map(ds => {
            const scores = DIMENSION_KEYS.map(k => ds.scores[k]);
            const points = buildPolygonPoints(cx, cy, maxR, scores);
            return (
              <polygon
                key={ds.label}
                points={points}
                fill={ds.color}
                fillOpacity={0.15}
                stroke={ds.color}
                strokeOpacity={0.7}
                strokeWidth={1.5}
              />
            );
          })}

          {/* 数据点 + hover 热区 */}
          {DIMENSION_KEYS.map((_, dimIdx) => {
            const [hx, hy] = polarToCartesian(cx, cy, maxR, dimIdx);
            return (
              <circle
                key={dimIdx}
                cx={hx}
                cy={hy}
                r={12}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={e => handleDimHover(e, dimIdx)}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {/* 维度标签 */}
          {showLabels && dimensionLabels.map((label, i) => {
            const labelR = maxR + 24;
            const [x, y] = polarToCartesian(cx, cy, labelR, i);
            return (
              <text
                key={i}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fillOpacity={0.5}
                fontSize={11}
              >
                {label}
              </text>
            );
          })}

          {/* 刻度数值 (右侧轴) */}
          {gridLevels.map(scale => (
            <text
              key={scale}
              x={cx + 4}
              y={cy - maxR * scale - 2}
              fill="white"
              fillOpacity={0.2}
              fontSize={8}
            >
              {Math.round(scale * 10)}
            </text>
          ))}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl"
            style={{
              left: Math.min(tooltip.x, size - 120),
              top: Math.max(tooltip.y - 60, 0),
            }}
          >
            <div className="text-white/70 font-medium mb-1">{tooltip.dim}</div>
            {tooltip.values.map(v => (
              <div key={v.label} className="flex items-center gap-2 text-white/50">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
                <span>{v.label}</span>
                <span className="text-white ml-auto">{v.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图例 */}
      {showLegend && datasets.length > 1 && (
        <div className="flex flex-wrap gap-3 justify-center">
          {datasets.map(ds => (
            <div key={ds.label} className="flex items-center gap-1.5 text-xs text-white/50">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ds.color }} />
              {ds.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
