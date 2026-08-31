import type {
  Aggregates,
  CatalogItem,
  DataSourceKind,
  LeaderboardRow,
  Lobby,
  Match,
  Page,
  Player,
  PlayerProfile,
  PurchaseResult,
  SimEntity,
  SimulationPlan,
  SimulationProgress,
  SourcesResponse,
  WorkloadMix,
  WorkloadOp,
  WorkloadResult,
} from '../types';

/**
 * Vite proxies /api to the backend, so the browser stays on one origin and the
 * EventSource below needs no CORS handling.
 */
const BASE = '/api';

async function request<T>(path: string, source?: DataSourceKind, init?: RequestInit): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (source) url.searchParams.set('source', source);

  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(source ? { 'x-data-source': source } : {}),
      ...init?.headers,
    },
  });

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const message =
      (body as { message?: string; error?: string; reason?: string }).message ??
      (body as { error?: string }).error ??
      (body as { reason?: string }).reason ??
      `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `&${s}` : '';
}

export const api = {
  sources: () => request<SourcesResponse>('/system/sources'),

  aggregates: (source: DataSourceKind) =>
    request<Aggregates & { source: DataSourceKind }>('/system/aggregates', source),

  leaderboard: (source: DataSourceKind, opts: { limit?: number; region?: string; rankTier?: string }) =>
    request<{ rows: LeaderboardRow[]; latencyMs: number }>(
      `/leaderboard?_=1${qs({ limit: opts.limit, region: opts.region, rankTier: opts.rankTier })}`,
      source,
    ),

  players: (
    source: DataSourceKind,
    opts: { limit?: number; cursor?: string; region?: string; rankTier?: string; search?: string },
  ) =>
    request<Page<Player>>(
      `/players?_=1${qs({
        limit: opts.limit,
        cursor: opts.cursor,
        region: opts.region,
        rankTier: opts.rankTier,
        search: opts.search,
      })}`,
      source,
    ),

  profile: (source: DataSourceKind, playerId: string) =>
    request<PlayerProfile>(`/players/${encodeURIComponent(playerId)}`, source),

  catalog: () => request<{ items: CatalogItem[] }>('/players/catalog'),

  purchase: (source: DataSourceKind, playerId: string, catalogItemId: string) =>
    request<PurchaseResult>(`/players/${encodeURIComponent(playerId)}/purchase`, source, {
      method: 'POST',
      body: JSON.stringify({ catalogItemId }),
    }),

  equip: (source: DataSourceKind, playerId: string, itemId: string, equip: boolean) =>
    request<{ item: unknown }>(
      `/players/${encodeURIComponent(playerId)}/inventory/${encodeURIComponent(itemId)}/equip`,
      source,
      { method: 'POST', body: JSON.stringify({ equip }) },
    ),

  lobbies: (source: DataSourceKind, status?: string) =>
    request<{ lobbies: Lobby[] }>(`/lobbies?_=1${qs({ status })}`, source),

  joinLobby: (source: DataSourceKind, lobbyId: string, playerId: string) =>
    request<{ ok: boolean; reason?: string; lobby?: Lobby }>(
      `/lobbies/${encodeURIComponent(lobbyId)}/join`,
      source,
      { method: 'POST', body: JSON.stringify({ playerId }) },
    ),

  completeMatch: (source: DataSourceKind, lobbyId: string) =>
    request<{ ok: boolean; reason?: string; match?: Match }>(
      `/lobbies/${encodeURIComponent(lobbyId)}/complete`,
      source,
      { method: 'POST' },
    ),

  completeRandomMatch: (source: DataSourceKind) =>
    request<{ ok: boolean; reason?: string; match?: Match; lobbyId?: string }>(
      '/lobbies/complete-random',
      source,
      { method: 'POST' },
    ),

  matches: (source: DataSourceKind, opts: { limit?: number; cursor?: string; playerId?: string }) =>
    request<Page<Match>>(
      `/matches?_=1${qs({ limit: opts.limit, cursor: opts.cursor, playerId: opts.playerId })}`,
      source,
    ),

  bulkInsert: (
    source: DataSourceKind,
    body: { players: number; inventoryPerPlayer: number; lobbies: number; matches: number },
  ) =>
    request<{ written: number; latencyMs: number; docsPerSecond: number }>('/admin/bulk-insert', source, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  clear: (source: DataSourceKind) =>
    request<{ deleted: number }>('/admin/clear', source, { method: 'POST' }),

  workload: (source: DataSourceKind, op: Exclude<WorkloadOp, 'insert'>, count: number) =>
    request<WorkloadResult>(`/admin/workload/${op}`, source, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  simulationPlan: (source: DataSourceKind, body: SimBody) =>
    request<SimulationPlan>('/simulation/plan', source, { method: 'POST', body: JSON.stringify(body) }),

  simulationStart: (source: DataSourceKind, body: SimBody) =>
    request<SimulationProgress>('/simulation/start', source, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  simulationJobs: () => request<{ jobs: SimulationProgress[] }>('/simulation/jobs'),

  simulationStop: (jobId: string) =>
    request<{ ok: boolean }>(`/simulation/jobs/${encodeURIComponent(jobId)}/stop`, undefined, {
      method: 'POST',
    }),

  simulationStopAll: () => request<{ ok: boolean }>('/simulation/stop-all', undefined, { method: 'POST' }),
};

export interface SimBody {
  entity: SimEntity;
  amount: number;
  timeframeMs: number;
  intervalMs: number;
  inventoryPerPlayer: number;
  mix: WorkloadMix;
}

export function streamUrl(source: DataSourceKind, leaderboardLimit = 50): string {
  return `${BASE}/stream?source=${source}&leaderboardLimit=${leaderboardLimit}`;
}
