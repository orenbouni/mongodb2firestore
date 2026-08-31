import { useState } from 'react';
import type { ConnectionInfo, DataSourceKind, SourcesResponse } from '../types';
import { StatusDot } from './primitives';

const SOURCE_LABEL: Record<DataSourceKind, string> = {
  firestore: 'Firestore',
  mongo: 'MongoDB',
};

/**
 * Categorical slots 1 and 2 carry source identity everywhere in the UI. The
 * accent is always paired with the source name, so identity never rests on
 * colour alone.
 */
const SOURCE_ACCENT: Record<DataSourceKind, { chip: string; ring: string; text: string }> = {
  firestore: { chip: 'bg-firestore', ring: 'ring-firestore', text: 'text-firestore' },
  mongo: { chip: 'bg-mongo', ring: 'ring-mongo', text: 'text-mongo' },
};

export function SourceSwitch({
  active,
  onChange,
  sources,
  busy,
}: {
  active: DataSourceKind;
  onChange: (s: DataSourceKind) => void;
  sources: SourcesResponse | null;
  busy: boolean;
}): JSX.Element {
  const statusFor = (kind: DataSourceKind): { available: boolean; latency?: number } => {
    const s = sources?.sources.find((x) => x.kind === kind);
    return { available: s?.available ?? false, latency: s?.ping?.latencyMs };
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-surface p-1"
      role="radiogroup"
      aria-label="Active data source"
    >
      {(['firestore', 'mongo'] as DataSourceKind[]).map((kind) => {
        const isActive = kind === active;
        const { available, latency } = statusFor(kind);
        const accent = SOURCE_ACCENT[kind];

        return (
          <button
            key={kind}
            role="radio"
            aria-checked={isActive}
            disabled={busy}
            onClick={() => onChange(kind)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
              ${isActive ? 'bg-surfaceRaised text-ink-primary ring-1 ' + accent.ring : 'text-ink-muted hover:text-ink-secondary'}
              disabled:cursor-wait`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${accent.chip} ${available ? '' : 'opacity-30'}`} aria-hidden />
            {SOURCE_LABEL[kind]}
            {latency !== undefined && (
              <span className="tabular text-[10px] text-ink-muted">{latency}ms</span>
            )}
            {!available && <span className="text-[10px] text-critical">down</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ConnectionPanel({
  source,
  info,
  sources,
  live,
}: {
  source: DataSourceKind;
  info: ConnectionInfo | null;
  sources: SourcesResponse | null;
  live: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const accent = SOURCE_ACCENT[source];
  const status = sources?.sources.find((s) => s.kind === source);
  const resolved = info ?? status?.info ?? null;

  const copy = async (): Promise<void> => {
    if (!resolved) return;
    await navigator.clipboard.writeText(resolved.connectionString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (!resolved) {
    return (
      <div className="card card-pad">
        <div className="label">Connection</div>
        <p className="mt-2 text-sm text-critical">
          {status?.error ?? 'Resolving connection…'}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-3 w-3 rounded-full ${accent.chip}`} aria-hidden />
          <div>
            <div className="text-sm font-semibold text-ink-primary">{resolved.displayName}</div>
            <div className="text-[11px] text-ink-muted">
              connected as <span className={accent.text}>{source}</span> · db{' '}
              <span className="text-ink-secondary">{resolved.database}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot ok={live} warn={!live} label={live ? 'stream live' : 'stream reconnecting'} />
          <StatusDot
            ok={resolved.supportsChangeStream}
            warn={!resolved.supportsChangeStream}
            label={resolved.supportsChangeStream ? 'server push' : 'polled'}
          />
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="label mb-1.5">Connection string</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border border-hairline bg-plane px-2.5 py-1.5 font-mono text-xs text-ink-secondary">
            {resolved.connectionString}
          </code>
          <button className="btn shrink-0 text-xs" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {resolved.addresses.map((a) => (
            <Row key={a.label} label={a.label} value={a.value} mono />
          ))}
          {resolved.details.map((d) => (
            <Row key={d.label} label={d.label} value={d.value} />
          ))}
          <Row label="Realtime" value={resolved.realtimeMechanism} />
          {sources && (
            <>
              <Row label="API server" value={`${sources.server.host}:${sources.server.apiPort}`} mono />
              <Row label="Frontend origin" value={window.location.origin} mono />
            </>
          )}
        </div>

        {sources && sources.server.addresses.length > 0 && (
          <div className="mt-3 border-t border-hairline pt-2.5">
            <div className="label mb-1">API host addresses</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {sources.server.addresses.map((a) => (
                <code key={a} className="font-mono text-[11px] text-ink-muted">
                  {a}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className={`truncate text-right text-ink-secondary ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}
