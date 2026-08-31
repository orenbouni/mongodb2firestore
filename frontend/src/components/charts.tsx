import { useState } from 'react';
import type { ThroughputSample } from '../hooks/useLiveStream';
import { fmt } from './primitives';

/**
 * Magnitude comparison across a handful of named categories, so: horizontal
 * bars in one sequential hue, direct-labeled. Not categorical colour - the
 * regions are not the subject, their sizes are.
 */
export function RegionBars({
  data,
}: {
  data: Array<{ region: string; players: number; avgMmr: number }>;
}): JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.players));

  return (
    <div className="space-y-2.5 px-4 py-3">
      {data.map((d) => {
        const pct = (d.players / max) * 100;
        const active = hover === d.region;
        return (
          <div
            key={d.region}
            className="group cursor-default"
            onMouseEnter={() => setHover(d.region)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-ink-secondary">{d.region}</span>
              <span className="tabular text-ink-muted">
                <span className="font-semibold text-ink-primary">{fmt(d.players)}</span> players
                <span className="mx-1.5 text-baseline">|</span>
                {fmt(d.avgMmr)} avg mmr
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-grid">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  active ? 'bg-seq-300' : 'bg-seq-400'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {data.length === 0 && <div className="py-4 text-center text-sm text-ink-muted">No region data</div>}
    </div>
  );
}

/**
 * Single-series trend, so one hue and no legend - the title names the series.
 * Crosshair + tooltip on hover, as every line chart should have.
 */
export function Sparkline({
  samples,
  height = 56,
}: {
  samples: ThroughputSample[];
  height?: number;
}): JSX.Element {
  const [idx, setIdx] = useState<number | null>(null);

  if (samples.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-hairline text-[11px] text-ink-muted"
        style={{ height }}
      >
        Start an auto-insert run to plot write throughput
      </div>
    );
  }

  const w = 100;
  const h = 100;
  const peak = Math.max(1, ...samples.map((s) => s.docsPerSecond));
  // 15% headroom keeps a steady series off the top edge, where a flat line
  // glued to the frame reads as a filled block rather than as data.
  const max = peak * 1.15;
  const step = w / (samples.length - 1);
  const latest = samples[samples.length - 1]?.docsPerSecond ?? 0;

  const pts = samples.map((s, i) => ({
    x: i * step,
    y: h - (s.docsPerSecond / max) * h,
    sample: s,
  }));

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const active = idx === null ? null : pts[idx];

  return (
    <div className="relative" style={{ height }}>
      {/* Scale and current value get their own band, so a steady line near the
          top of the plot never collides with them. */}
      <div className="mb-1 flex justify-between text-[10px] text-ink-muted">
        <span className="tabular">peak {fmt(peak)}/s</span>
        <span className="tabular text-ink-secondary">now {fmt(latest)}/s</span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 'calc(100% - 1rem)' }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * w;
          setIdx(Math.max(0, Math.min(pts.length - 1, Math.round(rel / step))));
        }}
        onMouseLeave={() => setIdx(null)}
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3987e5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3987e5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkFill)" />
        {/* vectorEffect keeps the 2px stroke true under non-uniform scaling. */}
        <path
          d={line}
          fill="none"
          stroke="#3987e5"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active && (
          <>
            <line
              x1={active.x}
              y1={0}
              x2={active.x}
              y2={h}
              stroke="#898781"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={active.x} cy={active.y} r={3} fill="#3987e5" stroke="#1a1a19" strokeWidth={2} />
          </>
        )}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute -top-1 rounded border border-hairline bg-plane px-2 py-1 text-[11px] text-ink-primary shadow-lg"
          style={{ left: `min(calc(${active.x}% + 6px), calc(100% - 96px))` }}
        >
          <span className="tabular font-semibold">{fmt(active.sample.docsPerSecond)}</span>
          <span className="ml-1 text-ink-muted">docs/s</span>
        </div>
      )}
    </div>
  );
}
