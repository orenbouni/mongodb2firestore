import type { ReactNode } from 'react';
import type { RankTier, Rarity } from '../types';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`card flex min-h-0 flex-col ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>}
            {subtitle && <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/**
 * A single current value. Deliberately not a one-bar chart — the number is the
 * message, and any trend rides along as a sparkline passed in via `chart`.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  chart,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  chart?: ReactNode;
  tone?: 'default' | 'good' | 'warning' | 'critical';
}): JSX.Element {
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'critical'
          ? 'text-critical'
          : 'text-ink-primary';

  return (
    <div className="card card-pad">
      <div className="label">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold leading-none ${toneClass}`}>{value}</span>
        {unit && <span className="text-xs text-ink-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>}
      {chart && <div className="mt-2">{chart}</div>}
    </div>
  );
}

/** A single ratio against a limit. Track is the same hue, recessed. */
export function Meter({
  value,
  max,
  label,
  tone = 'seq',
}: {
  value: number;
  max: number;
  label?: string;
  tone?: 'seq' | 'good' | 'warning';
}): JSX.Element {
  const pct = max === 0 ? 0 : Math.min(100, (value / max) * 100);
  const fill = tone === 'good' ? 'bg-good' : tone === 'warning' ? 'bg-warning' : 'bg-seq-400';

  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-grid"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? 'fill'}
      >
        {/* 4px rounded data-end, anchored to the track start. */}
        <div className={`h-full rounded-full ${fill} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const TIER_STEP: Record<RankTier, string> = {
  Bronze: 'bg-seq-600 text-white',
  Silver: 'bg-seq-500 text-white',
  Gold: 'bg-seq-400 text-white',
  Platinum: 'bg-seq-300 text-plane',
  Diamond: 'bg-seq-200 text-plane',
  Master: 'bg-seq-100 text-plane',
};

/**
 * Rank is an ordered scale, so the badge uses the validated single-hue ordinal
 * ramp rather than six unrelated hues. The tier name is always present, so the
 * ordering never rests on color alone.
 */
export function RankBadge({ tier }: { tier: RankTier }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_STEP[tier]}`}
    >
      {tier}
    </span>
  );
}

const RARITY_STYLE: Record<Rarity, string> = {
  Common: 'border-baseline text-ink-secondary',
  Rare: 'border-seq-400 text-seq-300',
  Epic: 'border-serious text-serious',
  Legendary: 'border-warning text-warning',
};

export function RarityTag({ rarity }: { rarity: Rarity }): JSX.Element {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${RARITY_STYLE[rarity]}`}>
      {rarity}
    </span>
  );
}

export function StatusDot({
  ok,
  label,
  warn = false,
}: {
  ok: boolean;
  label: string;
  warn?: boolean;
}): JSX.Element {
  const color = !ok ? 'bg-critical' : warn ? 'bg-warning' : 'bg-good';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-4 py-8 text-center text-sm text-ink-muted">{children}</div>;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtCompact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
