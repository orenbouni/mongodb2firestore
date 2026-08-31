import { Router } from 'express';
import type { DataSourceKind, WorkloadMix } from '../domain/types.js';
import {
  DEFAULT_MIX,
  SIM_LIMITS,
  SimulationEngine,
  expectedOpTotals,
  normaliseMix,
  simulation,
  type SimEntity,
} from '../services/simulationService.js';
import { asyncRoute, intParam, resolveSource, withAdapter } from './context.js';

export const simulationRouter = Router();

const ENTITIES: SimEntity[] = ['players', 'lobbies', 'matches', 'mixed'];

function parseEntity(value: unknown): SimEntity {
  return ENTITIES.includes(value as SimEntity) ? (value as SimEntity) : 'players';
}

function parseMix(value: unknown): WorkloadMix {
  return normaliseMix(value as Partial<WorkloadMix> | undefined);
}

/** Dry-run the batching maths so the UI can preview the plan before starting. */
simulationRouter.post('/plan', (req, res) => {
  const source = resolveSource(req) as DataSourceKind;
  const request = {
    source,
    entity: parseEntity(req.body?.entity),
    amount: intParam(req.body?.amount, 100, 1, SIM_LIMITS.MAX_AMOUNT),
    timeframeMs: intParam(req.body?.timeframeMs, 0, 0, 24 * 60 * 60 * 1000),
    intervalMs: intParam(req.body?.intervalMs, 250, SIM_LIMITS.MIN_INTERVAL_MS, SIM_LIMITS.MAX_INTERVAL_MS),
    inventoryPerPlayer: intParam(req.body?.inventoryPerPlayer, 5, 0, 50),
    mix: parseMix(req.body?.mix),
  };
  const plan = SimulationEngine.plan(request);

  // Expected operation counts across the whole run. A per-tick snapshot would
  // mislead: rare ops legitimately show zero on most individual ticks.
  const opTotals = expectedOpTotals(request.mix, request.amount);

  // Only inserts multiply by inventory; reads/updates/deletes touch roughly one
  // document per operation.
  const insertDocs =
    request.entity === 'players' ? opTotals.insert * (1 + request.inventoryPerPlayer) : opTotals.insert;

  res.json({
    ...plan,
    request,
    opTotals,
    estimatedDurationMs: request.timeframeMs > 0 ? request.timeframeMs : plan.plannedTicks * plan.intervalMs,
    estimatedDocuments: insertDocs + opTotals.read + opTotals.update + opTotals.delete,
  });
});

simulationRouter.post('/start', (req, res) => {
  const source = resolveSource(req) as DataSourceKind;
  const progress = simulation.start({
    source,
    entity: parseEntity(req.body?.entity),
    amount: intParam(req.body?.amount, 100, 1, SIM_LIMITS.MAX_AMOUNT),
    timeframeMs: intParam(req.body?.timeframeMs, 0, 0, 24 * 60 * 60 * 1000),
    intervalMs: intParam(req.body?.intervalMs, 250, SIM_LIMITS.MIN_INTERVAL_MS, SIM_LIMITS.MAX_INTERVAL_MS),
    inventoryPerPlayer: intParam(req.body?.inventoryPerPlayer, 5, 0, 50),
    mix: parseMix(req.body?.mix),
  });
  res.status(202).json(progress);
});

simulationRouter.get('/defaults', (_req, res) => {
  res.json({ mix: DEFAULT_MIX, limits: SIM_LIMITS });
});

simulationRouter.get('/jobs', (_req, res) => {
  res.json({ jobs: simulation.list() });
});

simulationRouter.post('/jobs/:jobId/stop', (req, res) => {
  const ok = simulation.stop(req.params['jobId'] as string);
  res.status(ok ? 202 : 404).json({ ok });
});

simulationRouter.post('/stop-all', (_req, res) => {
  simulation.stopAll();
  res.status(202).json({ ok: true });
});

// ---------------------------------------------------------------- one-shots

export const adminRouter = Router();
adminRouter.use(withAdapter);

adminRouter.post(
  '/bulk-insert',
  asyncRoute(async (req, res) => {
    const result = await req.adapter.bulkInsert({
      players: intParam(req.body?.players, 25, 0, 5000),
      inventoryPerPlayer: intParam(req.body?.inventoryPerPlayer, 5, 0, 50),
      lobbies: intParam(req.body?.lobbies, 3, 0, 2000),
      matches: intParam(req.body?.matches, 10, 0, 5000),
    });
    res.json({ source: req.source, ...result });
  }),
);

/**
 * One-shot workload drivers, so each operation kind can be triggered on its own
 * and watched in the provider console without starting a whole run.
 */
adminRouter.post(
  '/workload/:op',
  asyncRoute(async (req, res) => {
    const op = String(req.params['op']);
    const count = intParam(req.body?.count, 25, 1, 500);

    const run =
      op === 'read'
        ? req.adapter.readWorkload(count)
        : op === 'update'
          ? req.adapter.updateWorkload(count)
          : op === 'delete'
            ? req.adapter.deleteWorkload(count)
            : null;

    if (!run) {
      res.status(400).json({ error: 'unknown_op', op, allowed: ['read', 'update', 'delete'] });
      return;
    }

    res.json({ source: req.source, op, count, ...(await run) });
  }),
);

adminRouter.post(
  '/clear',
  asyncRoute(async (req, res) => {
    simulation.stopAll();
    const result = await req.adapter.clearAll();
    res.json({ source: req.source, ...result });
  }),
);
