import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { CatalogItem, DataSourceKind, InventoryItem, Player, PlayerProfile } from '../types';
import { Card, Empty, Meter, RankBadge, RarityTag, fmt, timeAgo } from './primitives';

export function PlayerSearch({
  source,
  onSelect,
  selectedPlayerId,
}: {
  source: DataSourceKind;
  onSelect: (playerId: string) => void;
  selectedPlayerId: string | null;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (reset: boolean): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.players(source, {
        limit: 20,
        search: term || undefined,
        cursor: reset ? undefined : (cursor ?? undefined),
      });
      setPlayers((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Debounced so each keystroke does not fire a query.
  useEffect(() => {
    const handle = setTimeout(() => void load(true), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, source]);

  return (
    <Card
      title="Player search"
      subtitle="cursor paginated (startAfter / limit)"
      className="h-full"
      actions={
        <input
          className="field w-44 py-1 text-xs"
          placeholder="username prefix…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      }
    >
      {error && <div className="px-4 py-3 text-sm text-critical">{error}</div>}
      {!error && players.length === 0 && !loading && <Empty>No players found.</Empty>}

      <div className="max-h-[22rem] overflow-y-auto">
        {players.map((p) => (
          <button
            key={p.playerId}
            onClick={() => onSelect(p.playerId)}
            className={`flex w-full items-center justify-between gap-3 border-b border-grid/60 px-4 py-2 text-left transition-colors hover:bg-surfaceRaised ${
              p.playerId === selectedPlayerId ? 'bg-surfaceRaised' : ''
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink-primary">{p.username}</div>
              <div className="text-[11px] text-ink-muted">
                {p.region} · lvl {p.level}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RankBadge tier={p.rankTier} />
              <span className="tabular w-12 text-right text-sm text-ink-secondary">{fmt(p.mmr)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-hairline px-4 py-2">
        <button className="btn w-full text-xs" disabled={!hasMore || loading} onClick={() => void load(false)}>
          {loading ? 'Loading…' : hasMore ? 'Load more' : 'End of results'}
        </button>
      </div>
    </Card>
  );
}

export function PlayerProfileCard({
  source,
  playerId,
  catalog,
  refreshToken,
  onPurchased,
}: {
  source: DataSourceKind;
  playerId: string | null;
  catalog: CatalogItem[];
  refreshToken: number;
  onPurchased: (message: string, ok: boolean) => void;
}): JSX.Element {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [itemChoice, setItemChoice] = useState<string>('');

  const reload = async (): Promise<void> => {
    if (!playerId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setProfile(await api.profile(source, playerId));
    } catch (err) {
      setError((err as Error).message);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, source, refreshToken]);

  useEffect(() => {
    if (!itemChoice && catalog.length > 0) setItemChoice(catalog[0]?.catalogId ?? '');
  }, [catalog, itemChoice]);

  const buy = async (): Promise<void> => {
    if (!playerId || !itemChoice) return;
    setBuying(true);
    try {
      const result = await api.purchase(source, playerId, itemChoice);
      onPurchased(
        `Bought ${result.item?.name ?? itemChoice} — ${fmt(result.creditsBefore ?? 0)} → ${fmt(
          result.creditsAfter ?? 0,
        )} credits (${result.latencyMs}ms)`,
        true,
      );
      await reload();
    } catch (err) {
      onPurchased(`Purchase rejected: ${(err as Error).message}`, false);
    } finally {
      setBuying(false);
    }
  };

  if (!playerId) {
    return (
      <Card title="Player profile" className="h-full">
        <Empty>Select a player from the leaderboard or search.</Empty>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Player profile" className="h-full">
        <div className="px-4 py-6 text-sm text-critical">{error}</div>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card title="Player profile" className="h-full">
        <Empty>{loading ? 'Loading profile…' : 'No profile.'}</Empty>
      </Card>
    );
  }

  const { player, inventory, loadout } = profile;

  return (
    <Card
      title={player.username}
      subtitle={
        <>
          {player.region} · level {player.level} · last seen {timeAgo(player.lastLoginAt)}
        </>
      }
      actions={<RankBadge tier={player.rankTier} />}
      className="h-full"
    >
      <div className="space-y-4 px-4 py-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Stat label="MMR" value={fmt(player.mmr)} />
          <Stat label="Win rate" value={`${(player.stats.winRate * 100).toFixed(1)}%`} />
          <Stat label="W / L" value={`${fmt(player.stats.wins)} / ${fmt(player.stats.losses)}`} />
          <Stat label="Playtime" value={`${fmt(Math.round(player.stats.totalPlaytimeHours))}h`} />
          <Stat label="Kills" value={fmt(player.stats.kills)} />
          <Stat label="Deaths" value={fmt(player.stats.deaths)} />
          <Stat label="Credits" value={fmt(player.currency.credits)} />
          <Stat label="Plasma cores" value={fmt(player.currency.plasmaCores)} />
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="label">Equipped power rating</span>
            <span className="tabular text-ink-secondary">
              {fmt(loadout.totalPowerRating)} from {loadout.equipped.length} equipped
            </span>
          </div>
          <Meter value={loadout.totalPowerRating} max={950 * 4} label="loadout power" />
        </div>

        <div className="rounded-md border border-hairline bg-surfaceRaised p-3">
          <div className="label mb-2">Atomic marketplace purchase</div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="field min-w-0 flex-1 py-1 text-xs"
              value={itemChoice}
              onChange={(e) => setItemChoice(e.target.value)}
            >
              {catalog.map((c) => (
                <option key={c.catalogId} value={c.catalogId}>
                  {c.name} — {fmt(c.priceCredits)} cr
                  {c.pricePlasmaCores > 0 ? ` + ${c.pricePlasmaCores} pc` : ''}
                </option>
              ))}
            </select>
            <button className="btn-primary text-xs" disabled={buying} onClick={() => void buy()}>
              {buying ? 'Running…' : 'Buy in transaction'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            Debits the wallet and writes the inventory document as one unit — the balance check is part
            of the same atomic operation, so a concurrent buy cannot overdraw.
          </p>
        </div>

        <div>
          <div className="label mb-2">Inventory ({inventory.length})</div>
          <InventoryGrid items={inventory} />
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tabular mt-0.5 text-sm font-semibold text-ink-primary">{value}</div>
    </div>
  );
}

function InventoryGrid({ items }: { items: InventoryItem[] }): JSX.Element {
  if (items.length === 0) {
    return <div className="text-sm text-ink-muted">No items.</div>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.itemId}
          className={`rounded-md border p-2.5 ${
            item.isEquipped ? 'border-good/50 bg-good/5' : 'border-hairline bg-surfaceRaised'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink-primary">{item.name}</div>
              <div className="text-[11px] capitalize text-ink-muted">{item.itemType}</div>
            </div>
            <RarityTag rarity={item.rarity} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="tabular text-xs text-ink-secondary">PWR {fmt(item.powerRating)}</span>
            {item.isEquipped && <span className="text-[10px] font-semibold text-good">EQUIPPED</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
