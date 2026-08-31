import type { DataSourceKind, LeaderboardRow, RankTier, Region } from '../types';
import { Card, Empty, RankBadge, fmt } from './primitives';

const REGIONS: Array<Region | ''> = ['', 'na-east', 'eu-west', 'ap-southeast'];
const TIERS: Array<RankTier | ''> = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master'];

export function LeaderboardTable({
  rows,
  source,
  region,
  rankTier,
  onRegion,
  onRankTier,
  onSelect,
  selectedPlayerId,
  latencyMs,
}: {
  rows: LeaderboardRow[];
  source: DataSourceKind;
  region: Region | '';
  rankTier: RankTier | '';
  onRegion: (r: Region | '') => void;
  onRankTier: (t: RankTier | '') => void;
  onSelect: (playerId: string) => void;
  selectedPlayerId: string | null;
  latencyMs: number | null;
}): JSX.Element {
  return (
    <Card
      title="Leaderboard"
      subtitle={
        <>
          ordered by mmr desc, winRate desc ·{' '}
          <span className={source === 'firestore' ? 'text-firestore' : 'text-mongo'}>{source}</span>
          {latencyMs !== null && <span className="tabular"> · {latencyMs}ms</span>}
        </>
      }
      actions={
        <div className="flex items-center gap-2">
          <select className="field py-1 text-xs" value={region} onChange={(e) => onRegion(e.target.value as Region | '')}>
            {REGIONS.map((r) => (
              <option key={r || 'all'} value={r}>
                {r === '' ? 'All regions' : r}
              </option>
            ))}
          </select>
          <select
            className="field py-1 text-xs"
            value={rankTier}
            onChange={(e) => onRankTier(e.target.value as RankTier | '')}
          >
            {TIERS.map((t) => (
              <option key={t || 'all'} value={t}>
                {t === '' ? 'All tiers' : t}
              </option>
            ))}
          </select>
        </div>
      }
      className="h-full"
    >
      {rows.length === 0 ? (
        <Empty>No players match this filter.</Empty>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-hairline text-left">
                <Th className="w-12 text-right">#</Th>
                <Th>Player</Th>
                <Th className="w-24">Tier</Th>
                <Th className="w-20 text-right">MMR</Th>
                <Th className="w-20 text-right">Win %</Th>
                <Th className="w-16 text-right">K/D</Th>
                <Th className="w-24">Region</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const kd = row.stats.deaths === 0 ? row.stats.kills : row.stats.kills / row.stats.deaths;
                const selected = row.playerId === selectedPlayerId;
                return (
                  <tr
                    key={row.playerId}
                    onClick={() => onSelect(row.playerId)}
                    className={`cursor-pointer border-b border-grid/60 transition-colors hover:bg-surfaceRaised ${
                      selected ? 'bg-surfaceRaised' : ''
                    }`}
                  >
                    <Td className="tabular text-right text-ink-muted">{row.rank}</Td>
                    <Td>
                      <div className="truncate font-medium text-ink-primary">{row.username}</div>
                      <div className="text-[11px] text-ink-muted">lvl {row.level}</div>
                    </Td>
                    <Td>
                      <RankBadge tier={row.rankTier} />
                    </Td>
                    <Td className="tabular text-right font-semibold text-ink-primary">{fmt(row.mmr)}</Td>
                    <Td className="tabular text-right text-ink-secondary">
                      {(row.stats.winRate * 100).toFixed(1)}%
                    </Td>
                    <Td className="tabular text-right text-ink-secondary">{kd.toFixed(2)}</Td>
                    <Td className="text-ink-muted">{row.region}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <th className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
