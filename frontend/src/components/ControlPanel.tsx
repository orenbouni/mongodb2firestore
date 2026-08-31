import { useEffect, useMemo, useState } from 'react';
import { api, type SimBody } from '../services/api';
import {
  WORKLOAD_OPS,
  type DataSourceKind,
  type SimEntity,
  type SimulationPlan,
  type SimulationProgress,
  type WorkloadMix,
  type WorkloadOp,
} from '../types';
import { Card, Meter, fmt, timeAgo } from './primitives';

const ENTITIES: Array<{ value: SimEntity; label: string }> = [
  { value: 'players', label: 'Players (+ inventory)' },
  { value: 'lobbies', label: 'Lobbies' },
  { value: 'matches', label: 'Matches' },
  { value: 'mixed', label: 'Mixed traffic' },
];

type IntervalUnit = 'ms' | 's';
type TimeframeUnit = 's' | 'min';

const INTERVAL_PRESETS: Array<{ label: string; ms: number }> = [
  { label: '1 ms', ms: 1 },
  { label: '10 ms', ms: 10 },
  { label: '100 ms', ms: 100 },
  { label: '500 ms', ms: 500 },
  { label: '1 s', ms: 1000 },
  { label: '5 s', ms: 5000 },
];

/** Operation identity. The dot always sits next to the op name. */
export const OP_COLOR: Record<WorkloadOp, string> = {
  insert: 'bg-op-insert',
  read: 'bg-op-read',
  update: 'bg-op-update',
  delete: 'bg-op-delete',
};

const OP_TEXT: Record<WorkloadOp, string> = {
  insert: 'text-op-insert',
  read: 'text-op-read',
  update: 'text-op-update',
  delete: 'text-op-delete',
};

const MIX_PRESETS: Array<{ label: string; hint: string; mix: WorkloadMix }> = [
  { label: 'Balanced', hint: 'general activity', mix: { insert: 40, read: 35, update: 20, delete: 5 } },
  { label: 'Read heavy', hint: 'live game traffic', mix: { insert: 10, read: 75, update: 13, delete: 2 } },
  { label: 'Write heavy', hint: 'ingest / backfill', mix: { insert: 70, read: 10, update: 18, delete: 2 } },
  { label: 'Churn', hint: 'update + delete', mix: { insert: 20, read: 15, update: 40, delete: 25 } },
];

export function ControlPanel({
  source,
  jobs,
  onDataChanged,
  onNotify,
}: {
  source: DataSourceKind;
  jobs: SimulationProgress[];
  onDataChanged: () => void;
  onNotify: (message: string, ok: boolean) => void;
}): JSX.Element {
  const [entity, setEntity] = useState<SimEntity>('players');
  const [amount, setAmount] = useState(500);
  const [inventoryPerPlayer, setInventoryPerPlayer] = useState(3);
  const [mix, setMix] = useState<WorkloadMix>(MIX_PRESETS[0]!.mix);

  const [intervalValue, setIntervalValue] = useState(100);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('ms');
  const [timeframeValue, setTimeframeValue] = useState(30);
  const [timeframeUnit, setTimeframeUnit] = useState<TimeframeUnit>('s');
  const [useTimeframe, setUseTimeframe] = useState(true);

  const [plan, setPlan] = useState<SimulationPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const intervalMs = intervalUnit === 'ms' ? intervalValue : intervalValue * 1000;
  const timeframeMs = !useTimeframe ? 0 : timeframeUnit === 's' ? timeframeValue * 1000 : timeframeValue * 60_000;

  const body: SimBody = useMemo(
    () => ({ entity, amount, timeframeMs, intervalMs, inventoryPerPlayer, mix }),
    [entity, amount, timeframeMs, intervalMs, inventoryPerPlayer, mix],
  );

  // Preview the batching maths server-side so the UI never disagrees with the
  // engine about what a run will actually do.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .simulationPlan(source, body)
        .then((p) => {
          if (!cancelled) setPlan(p);
        })
        .catch(() => {
          if (!cancelled) setPlan(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [source, body]);

  const activeJobs = jobs.filter((j) => j.status === 'running');
  const mixTotal = WORKLOAD_OPS.reduce((sum, op) => sum + mix[op], 0);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const job = await api.simulationStart(source, body);
      onNotify(`Workload started: ${fmt(job.target)} ops every ${job.intervalMs}ms`, true);
    } catch (err) {
      onNotify(`Could not start: ${(err as Error).message}`, false);
    } finally {
      setBusy(false);
    }
  };

  const stopAll = async (): Promise<void> => {
    await api.simulationStopAll();
    onNotify('Stop requested for all running jobs', true);
  };

  const action = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      onNotify(await fn(), true);
      onDataChanged();
    } catch (err) {
      onNotify(`${label} failed: ${(err as Error).message}`, false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Simulation & control"
      subtitle={
        <>
          all operations run against{' '}
          <span className={source === 'firestore' ? 'text-firestore' : 'text-mongo'}>{source}</span>
        </>
      }
      className="h-full"
    >
      <div className="space-y-4 px-4 py-3">
        {/* ------------------------------------------------------ workload */}
        <div className="rounded-md border border-hairline bg-surfaceRaised p-3">
          <div className="label mb-2.5">Automatic database workload</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Insert record type">
              <select
                className="field w-full py-1 text-xs"
                value={entity}
                onChange={(e) => setEntity(e.target.value as SimEntity)}
              >
                {ENTITIES.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Labeled>

            <Labeled label="Amount (total operations)">
              <input
                type="number"
                min={1}
                max={200000}
                className="field w-full py-1 text-xs"
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              />
            </Labeled>

            <Labeled label="Operation interval">
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  className="field w-full py-1 text-xs"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value) || 1))}
                />
                <select
                  className="field py-1 text-xs"
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
                >
                  <option value="ms">ms</option>
                  <option value="s">sec</option>
                </select>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {INTERVAL_PRESETS.map((p) => (
                  <button
                    key={p.ms}
                    onClick={() => {
                      setIntervalUnit(p.ms >= 1000 ? 's' : 'ms');
                      setIntervalValue(p.ms >= 1000 ? p.ms / 1000 : p.ms);
                    }}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                      intervalMs === p.ms
                        ? 'border-seq-400 text-seq-300'
                        : 'border-hairline text-ink-muted hover:text-ink-secondary'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Labeled>

            <Labeled
              label={
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={useTimeframe}
                    onChange={(e) => setUseTimeframe(e.target.checked)}
                    className="accent-seq-400"
                  />
                  <span>Time frame</span>
                </label>
              }
            >
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  disabled={!useTimeframe}
                  className="field w-full py-1 text-xs disabled:opacity-40"
                  value={timeframeValue}
                  onChange={(e) => setTimeframeValue(Math.max(1, Number(e.target.value) || 1))}
                />
                <select
                  className="field py-1 text-xs disabled:opacity-40"
                  disabled={!useTimeframe}
                  value={timeframeUnit}
                  onChange={(e) => setTimeframeUnit(e.target.value as TimeframeUnit)}
                >
                  <option value="s">sec</option>
                  <option value="min">min</option>
                </select>
              </div>
              <p className="mt-1 text-[10px] text-ink-muted">
                {useTimeframe
                  ? 'Spreads the operations evenly across this window.'
                  : 'Unbounded: one operation per interval until the amount is met.'}
              </p>
            </Labeled>

            {(entity === 'players' || entity === 'mixed') && (
              <Labeled label="Inventory items per player">
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="field w-full py-1 text-xs"
                  value={inventoryPerPlayer}
                  onChange={(e) => setInventoryPerPlayer(Math.max(0, Number(e.target.value) || 0))}
                />
              </Labeled>
            )}
          </div>

          {/* ------------------------------------------------- operation mix */}
          <div className="mt-3 border-t border-hairline pt-2.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Operation mix</span>
              <span className="tabular text-[10px] text-ink-muted">weights total {mixTotal}</span>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {MIX_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setMix(p.mix)}
                  title={p.hint}
                  className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                    WORKLOAD_OPS.every((op) => mix[op] === p.mix[op])
                      ? 'border-seq-400 text-seq-300'
                      : 'border-hairline text-ink-muted hover:text-ink-secondary'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <MixBar mix={mix} />

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WORKLOAD_OPS.map((op) => (
                <div key={op}>
                  <label className="mb-1 flex items-center gap-1.5 text-[10px] capitalize text-ink-secondary">
                    <span className={`h-2 w-2 rounded-full ${OP_COLOR[op]}`} aria-hidden />
                    {op}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="field w-full py-1 text-xs"
                    value={mix[op]}
                    onChange={(e) =>
                      setMix((prev) => ({ ...prev, [op]: Math.max(0, Number(e.target.value) || 0) }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          {plan && (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-hairline pt-2.5 sm:grid-cols-4">
                <PlanStat label="Ops / tick" value={fmt(plan.perTick)} />
                <PlanStat label="Ticks" value={fmt(plan.plannedTicks)} />
                <PlanStat label="Est. duration" value={formatMs(plan.estimatedDurationMs)} />
                <PlanStat label="Est. documents" value={fmt(plan.estimatedDocuments)} />
              </dl>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-muted">
                {WORKLOAD_OPS.map((op) => (
                  <span key={op} className="inline-flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${OP_COLOR[op]}`} aria-hidden />
                    <span className="capitalize">{op}</span>
                    <span className="tabular text-ink-secondary">{fmt(plan.opTotals[op])}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="mt-3 flex gap-2">
            <button className="btn-primary flex-1 text-xs" disabled={busy} onClick={() => void start()}>
              Start workload
            </button>
            <button className="btn text-xs" disabled={activeJobs.length === 0} onClick={() => void stopAll()}>
              Stop all ({activeJobs.length})
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------- job list */}
        {jobs.length > 0 && (
          <div>
            <div className="label mb-2">Runs</div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {jobs.slice(0, 6).map((job) => (
                <JobRow key={job.jobId} job={job} />
              ))}
            </div>
          </div>
        )}

        {/* --------------------------------------------------- one-shot ops */}
        <div>
          <div className="label mb-2">One-shot operations</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <OpButton
              op="insert"
              label="Insert 50 players + 5 lobbies"
              busy={busy}
              run={() =>
                action('Insert', async () => {
                  const r = await api.bulkInsert(source, {
                    players: 50,
                    inventoryPerPlayer: 4,
                    lobbies: 5,
                    matches: 20,
                  });
                  return `Wrote ${fmt(r.written)} docs in ${r.latencyMs}ms (${fmt(r.docsPerSecond)}/s)`;
                })
              }
            />
            <OpButton
              op="read"
              label="Run 50 reads"
              busy={busy}
              run={() =>
                action('Read', async () => {
                  const r = await api.workload(source, 'read', 50);
                  return `${r.detail} — ${fmt(r.documents)} docs in ${r.latencyMs}ms`;
                })
              }
            />
            <OpButton
              op="update"
              label="Update 50 players"
              busy={busy}
              run={() =>
                action('Update', async () => {
                  const r = await api.workload(source, 'update', 50);
                  return `${r.detail} in ${r.latencyMs}ms`;
                })
              }
            />
            <OpButton
              op="delete"
              label="Delete 25 old records"
              busy={busy}
              run={() =>
                action('Delete', async () => {
                  const r = await api.workload(source, 'delete', 25);
                  return `${r.detail} in ${r.latencyMs}ms`;
                })
              }
            />
            <button
              className="btn text-xs sm:col-span-2"
              disabled={busy}
              onClick={() =>
                void action('Complete match', async () => {
                  const r = await api.completeRandomMatch(source);
                  return r.ok
                    ? `Match closed: ${r.match?.gameMode} won by team ${r.match?.winningTeam}`
                    : `No lobby available (${r.reason})`;
                })
              }
            >
              Complete a random match (transaction)
            </button>
            <button
              className="btn-danger text-xs sm:col-span-2"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete every Aegis document in ${source}? This cannot be undone.`)) return;
                void action('Clear', async () => {
                  const r = await api.clear(source);
                  return `Cleared ${fmt(r.deleted)} root documents from ${source}`;
                });
              }}
            >
              Clear all data in {source}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function OpButton({
  op,
  label,
  busy,
  run,
}: {
  op: WorkloadOp;
  label: string;
  busy: boolean;
  run: () => void;
}): JSX.Element {
  return (
    <button className="btn flex items-center gap-2 text-xs" disabled={busy} onClick={run}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${OP_COLOR[op]}`} aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Part-to-whole across four ops: stacked bar, 2px surface gaps between fills. */
function MixBar({ mix }: { mix: WorkloadMix }): JSX.Element {
  const total = WORKLOAD_OPS.reduce((sum, op) => sum + mix[op], 0) || 1;
  return (
    <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-grid">
      {WORKLOAD_OPS.filter((op) => mix[op] > 0).map((op) => (
        <div
          key={op}
          className={`h-full rounded-full ${OP_COLOR[op]} transition-all duration-300`}
          style={{ width: `${(mix[op] / total) * 100}%` }}
          title={`${op}: ${Math.round((mix[op] / total) * 100)}%`}
        />
      ))}
    </div>
  );
}

function JobRow({ job }: { job: SimulationProgress }): JSX.Element {
  const tone =
    job.status === 'running'
      ? 'text-good'
      : job.status === 'error'
        ? 'text-critical'
        : job.status === 'stopped'
          ? 'text-warning'
          : 'text-ink-muted';

  return (
    <div className="rounded-md border border-hairline bg-surfaceRaised p-2.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-ink-primary">{job.entity}</span>
        <span className={`text-[11px] font-medium ${tone}`}>{job.status}</span>
      </div>

      <div className="mt-1.5">
        <Meter
          value={job.inserted}
          max={job.target}
          label="operation progress"
          tone={job.status === 'error' ? 'warning' : job.status === 'running' ? 'seq' : 'good'}
        />
      </div>

      <div className="tabular mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-muted">
        <span>
          {fmt(job.inserted)} / {fmt(job.target)} ops
        </span>
        <span>{fmt(job.documentsWritten)} docs</span>
        <span>{fmt(job.docsPerSecond)} docs/s</span>
        <span>{job.intervalMs}ms</span>
        <span>{formatMs(job.elapsedMs)}</span>
      </div>

      {/* Per-operation totals: the point of the whole panel, so they are
          always visible rather than hidden behind a hover. */}
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {WORKLOAD_OPS.map((op) => (
          <div key={op} className="rounded border border-hairline bg-plane px-1.5 py-1">
            <div className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${OP_COLOR[op]}`} aria-hidden />
              <span className="truncate text-[9px] capitalize text-ink-muted">{op}</span>
            </div>
            <div className="tabular mt-0.5 text-[11px] font-semibold text-ink-primary">
              {fmt(job.ops?.[op] ?? 0)}
            </div>
            <div className="tabular text-[9px] text-ink-muted">{fmt(job.opDocuments?.[op] ?? 0)} docs</div>
          </div>
        ))}
      </div>

      {job.recent && job.recent.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-ink-muted hover:text-ink-secondary">
            Activity log ({job.recent.length})
          </summary>
          <ul className="mt-1.5 space-y-1">
            {job.recent.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="flex items-start gap-1.5 text-[10px]">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${OP_COLOR[entry.op]}`} aria-hidden />
                <span className={`w-12 shrink-0 capitalize ${OP_TEXT[entry.op]}`}>{entry.op}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted" title={entry.detail}>
                  {entry.detail}
                </span>
                <span className="tabular shrink-0 text-ink-muted">{entry.latencyMs}ms</span>
                <span className="tabular w-14 shrink-0 text-right text-ink-muted">{timeAgo(entry.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {job.error && <div className="mt-1 text-[10px] text-critical">{job.error}</div>}
    </div>
  );
}

function Labeled({ label, children }: { label: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      {children}
    </div>
  );
}

function PlanStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="tabular text-xs font-semibold text-ink-secondary">{value}</dd>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
