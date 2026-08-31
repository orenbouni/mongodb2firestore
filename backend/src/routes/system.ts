import { Router } from 'express';
import os from 'node:os';
import { getAdapter, probeSources } from '../adapters/registry.js';
import { env } from '../config/env.js';
import { CATALOG } from '../domain/catalog.js';
import { GAME_MODES, RANK_TIERS, REGIONS } from '../domain/types.js';
import { getAggregates } from '../services/leaderboardService.js';
import { SIM_LIMITS } from '../services/simulationService.js';
import { asyncRoute, resolveSource, withAdapter } from './context.js';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

/** Everything the UI needs to render the source switch and its status badges. */
systemRouter.get(
  '/sources',
  asyncRoute(async (_req, res) => {
    const statuses = await probeSources();

    const infos = await Promise.all(
      statuses.map(async (s) => {
        if (!s.available) return { ...s, info: null, ping: null };
        const adapter = await getAdapter(s.kind);
        const ping = await adapter.ping();
        return { ...s, info: adapter.connectionInfo(), ping };
      }),
    );

    res.json({
      defaultSource: env.defaultSource,
      server: {
        host: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        nodeVersion: process.version,
        addresses: localAddresses(),
        apiPort: env.port,
      },
      sources: infos,
    });
  }),
);

systemRouter.get(
  '/connection',
  withAdapter,
  asyncRoute(async (req, res) => {
    const ping = await req.adapter.ping();
    res.json({ source: req.source, info: req.adapter.connectionInfo(), ping });
  }),
);

systemRouter.get(
  '/aggregates',
  withAdapter,
  asyncRoute(async (req, res) => {
    res.json({ source: req.source, ...(await getAggregates(req.adapter)) });
  }),
);

systemRouter.get('/metadata', (req, res) => {
  res.json({
    source: resolveSource(req),
    regions: REGIONS,
    rankTiers: RANK_TIERS,
    gameModes: GAME_MODES,
    catalog: CATALOG,
    simulationLimits: SIM_LIMITS,
  });
});

function localAddresses(): string[] {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, ifaces]) =>
      (ifaces ?? [])
        .filter((i) => i.family === 'IPv4' && !i.internal)
        .map((i) => `${name}: ${i.address}`),
    )
    .sort();
}
