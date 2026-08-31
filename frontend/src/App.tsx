import { useCallback, useEffect, useMemo, useState } from 'react';
import { RegionBars, Sparkline } from './components/charts';
import { ControlPanel, OP_COLOR } from './components/ControlPanel';
import { LeaderboardTable } from './components/LeaderboardTable';
import { LobbyBrowser } from './components/LobbyBrowser';
import { PlayerProfileCard, PlayerSearch } from './components/PlayerInspector';
import { Card, StatTile, fmt, fmtCompact } from './components/primitives';
import { ConnectionPanel, SourceSwitch } from './components/SourceSwitch';
import { useLiveStream } from './hooks/useLiveStream';
import { api } from './services/api';
import {
  WORKLOAD_OPS,
  type CatalogItem,
  type DataSourceKind,
  type RankTier,
  type Region,
  type SourcesResponse,
  type WorkloadOp,
} from './types';

interface Toast {
  id: number;
  message: string;
  ok: boolean;
}

export default function App(): JSX.Element {
  const [source, setSource] = useState<DataSourceKind>('firestore');
  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | ''>('');
  const [rankTier, setRankTier] = useState<RankTier | ''>('');
  const [filteredRows, setFilteredRows] = useState<ReturnType<typeof useLiveStream>['leaderboard']>([]);
  const [filterLatency, setFilterLatency] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [busyLobbyId, setBusyLobbyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const live = useLiveStream(source, 50);

  const notify = useCallback((message: string, ok: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, ok }].slice(-4));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  useEffect(() => {
    void api.sources().then(setSources).catch(() => setSources(null));
    void api.catalog().then((c) => setCatalog(c.items)).catch(() => setCatalog([]));
  }, []);

  // Refresh the source badges whenever the active source changes, so the
  // latency figures next to the switch stay meaningful.
  useEffect(() => {
    const handle = setInterval(() => {
      void api.sources().then(setSources).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(handle);
  }, []);

  const filtersActive = region !== '' || rankTier !== '';

  // The SSE leaderboard is always global top-50. When a filter is on we fall
  // back to a scoped query, refreshed whenever the live stream ticks.
  useEffect(() => {
    if (!filtersActive) {
      setFilteredRows([]);
      setFilterLatency(null);
      return;
    }
    let cancelled = false;
    api
      .leaderboard(source, { limit: 50, region: region || undefined, rankTier: rankTier || undefined })
      .then((r) => {
        if (cancelled) return;
        setFilteredRows(r.rows);
        setFilterLatency(r.latencyMs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source, region, rankTier, filtersActive, live.eventCount]);

  const rows = filtersActive ? filteredRows : live.leaderboard;
  const jobs = useMemo(
    () => Object.values(live.jobs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [live.jobs],
  );

  const agg = live.aggregates;
  const runningJob = jobs.find((j) => j.status === 'running');

  // Session totals across every job on this source, so the activity panel keeps
  // reading meaningfully after a run finishes.
  const opTotals = useMemo(() => {
    const ops: Record<WorkloadOp, number> = { insert: 0, read: 0, update: 0, delete: 0 };
    const docs: Record<WorkloadOp, number> = { insert: 0, read: 0, update: 0, delete: 0 };
    for (const job of jobs) {
      for (const op of WORKLOAD_OPS) {
        ops[op] += job.ops?.[op] ?? 0;
        docs[op] += job.opDocuments?.[op] ?? 0;
      }
    }
    return { ops, docs };
  }, [jobs]);

  const lobbyAction = async (label: string, lobbyId: string, fn: () => Promise<string>): Promise<void> => {
    setBusyLobbyId(lobbyId);
    try {
      notify(await fn(), true);
    } catch (err) {
      notify(`${label} failed: ${(err as Error).message}`, false);
    } finally {
      setBusyLobbyId(null);
    }
  };

  const joinLobby = (lobbyId: string): void => {
    void lobbyAction('Join', lobbyId, async () => {
      // Pick a real player at random so the join exercises the same transaction
      // path the game client would.
      const page = await api.players(source, { limit: 40 });
      const pick = page.items[Math.floor(Math.random() * page.items.length)];
      if (!pick) throw new Error('no players available to join');
      const r = await api.joinLobby(source, lobbyId, pick.playerId);
      if (!r.ok) throw new Error(r.reason ?? 'rejected');
      return `${pick.username} joined lobby (${r.lobby?.playerList.length}/${r.lobby?.maxPlayers})`;
    });
  };

  const completeLobby = (lobbyId: string): void => {
    void lobbyAction('Complete', lobbyId, async () => {
      const r = await api.completeMatch(source, lobbyId);
      if (!r.ok) throw new Error(r.reason ?? 'rejected');
      return `Match written — team ${r.match?.winningTeam} won ${r.match?.gameMode}`;
    });
  };

  return (
    <div className="min-h-full bg-plane">
      <header className="sticky top-0 z-30 border-b border-hairline bg-plane/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-ink-primary">
              Aegis Legends: Galactic Arena
            </h1>
            <p className="text-[11px] text-ink-muted">
              Live ops console · Firestore vs MongoDB on Google Cloud
            </p>
          </div>
          <SourceSwitch active={source} onChange={setSource} sources={sources} busy={false} />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-5 py-5">
        <ConnectionPanel source={source} info={live.connection} sources={sources} live={live.connected} />

        {live.error && (
          <div className="card border-critical/40 px-4 py-3 text-sm text-critical">{live.error}</div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Players" value={agg ? fmt(agg.counts.players) : '—'} hint="total documents" />
          <StatTile
            label="Active lobbies"
            value={agg ? fmt(agg.counts.activeLobbies) : '—'}
            hint={agg ? `${fmt(agg.counts.lobbies)} total` : undefined}
            tone="good"
          />
          <StatTile label="Matches" value={agg ? fmt(agg.counts.matches) : '—'} hint="historical telemetry" />
          <StatTile
            label="Avg MMR"
            value={agg ? fmt(agg.avgMmr) : '—'}
            hint={agg ? `${fmt(agg.minMmr)} – ${fmt(agg.maxMmr)}` : undefined}
          />
          <StatTile
            label="Credits in economy"
            value={agg ? fmtCompact(agg.sumCredits) : '—'}
            hint="sum() aggregation"
          />
          <StatTile
            label="Aggregate latency"
            value={agg ? agg.latencyMs : '—'}
            unit="ms"
            hint={`${live.eventCount} live events`}
            tone={agg && agg.latencyMs > 1500 ? 'warning' : 'default'}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card
            title="Players by region"
            subtitle="count() + average(mmr) per partition"
            className="lg:col-span-1"
          >
            <RegionBars data={agg?.byRegion ?? []} />
          </Card>

          <Card
            title="Database activity"
            subtitle={
              runningJob
                ? `${runningJob.entity} · ${fmt(runningJob.docsPerSecond)} docs/s · ${fmt(runningJob.perTick)} ops/tick`
                : 'documents per second, and operations issued this session'
            }
            className="lg:col-span-2"
          >
            <div className="px-4 py-3">
              <Sparkline samples={live.throughput} height={96} />
              <div className="mt-3 grid grid-cols-4 gap-2">
                {WORKLOAD_OPS.map((op) => (
                  <div key={op} className="rounded border border-hairline bg-surfaceRaised px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${OP_COLOR[op]}`} aria-hidden />
                      <span className="truncate text-[10px] capitalize text-ink-muted">{op}</span>
                    </div>
                    <div className="tabular mt-0.5 text-sm font-semibold text-ink-primary">
                      {fmt(opTotals.ops[op])}
                    </div>
                    <div className="tabular text-[10px] text-ink-muted">
                      {fmt(opTotals.docs[op])} docs
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <LobbyBrowser
            lobbies={live.lobbies}
            source={source}
            onComplete={completeLobby}
            onJoin={joinLobby}
            busyLobbyId={busyLobbyId}
          />
          <LeaderboardTable
            rows={rows}
            source={source}
            region={region}
            rankTier={rankTier}
            onRegion={setRegion}
            onRankTier={setRankTier}
            onSelect={setSelectedPlayerId}
            selectedPlayerId={selectedPlayerId}
            latencyMs={filtersActive ? filterLatency : (agg?.latencyMs ?? null)}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <PlayerSearch source={source} onSelect={setSelectedPlayerId} selectedPlayerId={selectedPlayerId} />
          <PlayerProfileCard
            source={source}
            playerId={selectedPlayerId}
            catalog={catalog}
            refreshToken={refreshToken}
            onPurchased={notify}
          />
          <ControlPanel
            source={source}
            jobs={jobs}
            onDataChanged={() => setRefreshToken((n) => n + 1)}
            onNotify={notify}
          />
        </section>
      </main>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur ${
              t.ok ? 'border-good/40 bg-surface text-ink-secondary' : 'border-critical/50 bg-surface text-critical'
            }`}
          >
            <span className="mr-1.5 font-semibold">{t.ok ? 'OK' : 'Error'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
