import type { Aggregates, DataAdapter, LeaderboardOptions, LeaderboardRow } from '../domain/types.js';

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  latencyMs: number;
  scope: { region: string; rankTier: string; limit: number };
}

export async function getLeaderboard(
  adapter: DataAdapter,
  opts: LeaderboardOptions,
): Promise<LeaderboardResponse> {
  const t0 = performance.now();
  const rows = await adapter.leaderboard(opts);
  return {
    rows,
    latencyMs: Math.round(performance.now() - t0),
    scope: { region: opts.region ?? 'global', rankTier: opts.rankTier ?? 'all', limit: opts.limit },
  };
}

export async function getAggregates(adapter: DataAdapter): Promise<Aggregates> {
  return adapter.aggregates();
}
