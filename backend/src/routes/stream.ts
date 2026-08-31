import { Router, type Response } from 'express';
import { getAdapter } from '../adapters/registry.js';
import { simulation, type SimulationProgress } from '../services/simulationService.js';
import { intParam, resolveSource } from './context.js';

export const streamRouter = Router();

const AGGREGATE_REFRESH_MS = 4000;

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * One SSE connection carries every live topic for the selected source.
 * Firestore topics come from onSnapshot; MongoDB topics come from the
 * adapter's polling fallback. The client cannot tell the difference apart
 * from the mechanism reported in the `connection` event.
 */
streamRouter.get('/', (req, res) => {
  const source = resolveSource(req);
  const leaderboardLimit = intParam(req.query['leaderboardLimit'], 50, 1, 200);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const cleanups: Array<() => void> = [];
  let closed = false;

  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* listener already torn down */
      }
    }
    res.end();
  };

  req.on('close', shutdown);
  req.on('error', shutdown);

  const onSimProgress = (p: SimulationProgress): void => {
    if (p.source === source) send(res, 'simulation', p);
  };
  simulation.on('progress', onSimProgress);
  cleanups.push(() => simulation.off('progress', onSimProgress));

  // Proxies and browsers drop idle event streams; a comment frame keeps it warm.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  cleanups.push(() => clearInterval(heartbeat));

  void (async () => {
    try {
      const adapter = await getAdapter(source);
      if (closed) return;

      send(res, 'connection', { source, info: adapter.connectionInfo() });

      cleanups.push(adapter.subscribeLobbies((lobbies) => send(res, 'lobbies', { source, lobbies })));
      cleanups.push(
        adapter.subscribeLeaderboard(leaderboardLimit, (rows) => send(res, 'leaderboard', { source, rows })),
      );

      const pushAggregates = async (): Promise<void> => {
        if (closed) return;
        try {
          send(res, 'aggregates', { source, ...(await adapter.aggregates()) });
        } catch (err) {
          send(res, 'error', { source, message: (err as Error).message });
        }
      };

      await pushAggregates();
      const aggTimer = setInterval(() => void pushAggregates(), AGGREGATE_REFRESH_MS);
      cleanups.push(() => clearInterval(aggTimer));
    } catch (err) {
      send(res, 'error', { source, message: (err as Error).message });
      shutdown();
    }
  })();
});
