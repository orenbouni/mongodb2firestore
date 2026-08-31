import { EventEmitter } from 'node:events';
import { getAdapter } from '../adapters/registry.js';
import {
  WORKLOAD_OPS,
  type BulkInsertRequest,
  type DataAdapter,
  type DataSourceKind,
  type WorkloadMix,
  type WorkloadOp,
} from '../domain/types.js';

export type SimEntity = 'players' | 'lobbies' | 'matches' | 'mixed';

export interface SimulationRequest {
  source: DataSourceKind;
  entity: SimEntity;
  /** Total operations to run across the whole job. */
  amount: number;
  /** Wall-clock window to spread the run over, in ms. 0 = run flat out. */
  timeframeMs: number;
  /** Delay between batches, 1ms - 60000ms. */
  intervalMs: number;
  inventoryPerPlayer: number;
  /** Relative weights for insert / read / update / delete. */
  mix: WorkloadMix;
}

export type OpCounts = Record<WorkloadOp, number>;

export interface ActivityEntry {
  at: string;
  op: WorkloadOp;
  documents: number;
  latencyMs: number;
  detail: string;
}

export interface SimulationProgress {
  jobId: string;
  source: DataSourceKind;
  entity: SimEntity;
  status: 'running' | 'completed' | 'stopped' | 'error';
  /** Operations issued so far, against `target`. */
  inserted: number;
  target: number;
  ticks: number;
  plannedTicks: number;
  perTick: number;
  intervalMs: number;
  elapsedMs: number;
  docsPerSecond: number;
  lastBatchMs: number;
  /** Documents touched by any operation, not just writes. */
  documentsWritten: number;
  mix: WorkloadMix;
  ops: OpCounts;
  /** Documents touched, split by operation. */
  opDocuments: OpCounts;
  recent: ActivityEntry[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const MIN_INTERVAL_MS = 1;
const MAX_INTERVAL_MS = 60_000;
const MAX_AMOUNT = 200_000;
const RECENT_LIMIT = 12;

export const DEFAULT_MIX: WorkloadMix = { insert: 40, read: 35, update: 20, delete: 5 };

function zeroCounts(): OpCounts {
  return { insert: 0, read: 0, update: 0, delete: 0 };
}

export function normaliseMix(raw: Partial<WorkloadMix> | undefined): WorkloadMix {
  const mix = zeroCounts();
  let total = 0;

  for (const op of WORKLOAD_OPS) {
    const v = Number(raw?.[op]);
    const clean = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    mix[op] = clean;
    total += clean;
  }

  return total === 0 ? { ...DEFAULT_MIX } : mix;
}

/**
 * Allocates each tick's slots across the four operations.
 *
 * Rounding per tick in isolation starves rare operations: at 4 slots a 5%
 * delete weight wants 0.2 of a slot, floors to zero, and never runs at all.
 * So fractional credit carries across ticks — 0.2 per tick accumulates and
 * fires a delete roughly every fifth tick, which is what 5% actually means.
 */
export class OpScheduler {
  private credit: OpCounts = zeroCounts();
  private readonly total: number;

  constructor(private readonly mix: WorkloadMix) {
    this.total = WORKLOAD_OPS.reduce((sum, op) => sum + mix[op], 0);
  }

  next(slots: number): OpCounts {
    const out = zeroCounts();
    if (this.total === 0 || slots <= 0) return out;

    let assigned = 0;
    for (const op of WORKLOAD_OPS) {
      this.credit[op] += (this.mix[op] / this.total) * slots;
      const take = Math.floor(this.credit[op]);
      if (take > 0) {
        out[op] = take;
        this.credit[op] -= take;
        assigned += take;
      }
    }

    // Hand any slot lost to rounding to whichever op is owed the most.
    const eligible = WORKLOAD_OPS.filter((op) => this.mix[op] > 0);
    while (assigned < slots && eligible.length > 0) {
      const op = eligible.reduce((best, o) => (this.credit[o] > this.credit[best] ? o : best), eligible[0]!);
      out[op] += 1;
      this.credit[op] -= 1;
      assigned += 1;
    }

    return out;
  }
}

/** Expected operation counts over a whole run — what the plan preview shows. */
export function expectedOpTotals(mix: WorkloadMix, amount: number): OpCounts {
  const total = WORKLOAD_OPS.reduce((sum, op) => sum + mix[op], 0);
  const out = zeroCounts();
  if (total === 0) return out;

  let assigned = 0;
  for (const op of WORKLOAD_OPS) {
    out[op] = Math.floor((mix[op] / total) * amount);
    assigned += out[op];
  }

  // Give the leftover to the heaviest weight so the totals sum to `amount`.
  const heaviest = WORKLOAD_OPS.reduce((best, op) => (mix[op] > mix[best] ? op : best), WORKLOAD_OPS[0]!);
  out[heaviest] += amount - assigned;

  return out;
}

export class SimulationEngine extends EventEmitter {
  private jobs = new Map<string, SimulationProgress>();
  private stopFlags = new Set<string>();

  list(): SimulationProgress[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(jobId: string): SimulationProgress | undefined {
    return this.jobs.get(jobId);
  }

  stop(jobId: string): boolean {
    if (!this.jobs.has(jobId)) return false;
    this.stopFlags.add(jobId);
    return true;
  }

  stopAll(): void {
    for (const id of this.jobs.keys()) {
      if (this.jobs.get(id)?.status === 'running') this.stopFlags.add(id);
    }
  }

  /** Validates and normalises a request, returning the derived batching plan. */
  static plan(req: SimulationRequest): { perTick: number; plannedTicks: number; intervalMs: number } {
    const intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(req.intervalMs)));
    const amount = Math.min(MAX_AMOUNT, Math.max(1, Math.floor(req.amount)));

    if (req.timeframeMs <= 0) {
      // No window given: one operation per tick, so the interval alone sets the rate.
      return { perTick: 1, plannedTicks: amount, intervalMs };
    }

    const plannedTicks = Math.max(1, Math.floor(req.timeframeMs / intervalMs));
    const perTick = Math.max(1, Math.ceil(amount / plannedTicks));
    return { perTick, plannedTicks: Math.min(plannedTicks, Math.ceil(amount / perTick)), intervalMs };
  }

  start(req: SimulationRequest): SimulationProgress {
    const jobId = crypto.randomUUID();
    const { perTick, plannedTicks, intervalMs } = SimulationEngine.plan(req);
    const target = Math.min(MAX_AMOUNT, Math.max(1, Math.floor(req.amount)));
    const mix = normaliseMix(req.mix);

    const progress: SimulationProgress = {
      jobId,
      source: req.source,
      entity: req.entity,
      status: 'running',
      inserted: 0,
      target,
      ticks: 0,
      plannedTicks,
      perTick,
      intervalMs,
      elapsedMs: 0,
      docsPerSecond: 0,
      lastBatchMs: 0,
      documentsWritten: 0,
      mix,
      ops: zeroCounts(),
      opDocuments: zeroCounts(),
      recent: [],
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, progress);
    this.emit('progress', progress);
    void this.run(jobId, { ...req, mix }, { perTick, intervalMs, target });

    return progress;
  }

  private async run(
    jobId: string,
    req: SimulationRequest,
    plan: { perTick: number; intervalMs: number; target: number },
  ): Promise<void> {
    const progress = this.jobs.get(jobId);
    if (!progress) return;

    const startedAt = performance.now();
    const deadline = req.timeframeMs > 0 ? startedAt + req.timeframeMs : Infinity;
    // One scheduler for the whole job, so fractional credit persists tick to tick.
    const scheduler = new OpScheduler(req.mix);

    try {
      const adapter = await getAdapter(req.source);

      while (progress.inserted < plan.target) {
        if (this.stopFlags.has(jobId)) {
          progress.status = 'stopped';
          break;
        }
        if (performance.now() >= deadline) {
          // Window expired before the target was met - report honestly rather
          // than silently overrunning the requested timeframe.
          progress.status = 'completed';
          break;
        }

        const remaining = plan.target - progress.inserted;
        const slots = Math.min(plan.perTick, remaining);
        const grouped = scheduler.next(slots);
        const t0 = performance.now();

        // Each op kind runs as one batched call per tick.
        for (const op of WORKLOAD_OPS) {
          const n = grouped[op];
          if (n === 0) continue;

          const result = await runOp(adapter, op, n, req);
          progress.ops[op] += n;
          progress.opDocuments[op] += result.documents;
          progress.documentsWritten += result.documents;
          progress.recent = [
            {
              at: new Date().toISOString(),
              op,
              documents: result.documents,
              latencyMs: result.latencyMs,
              detail: result.detail,
            },
            ...progress.recent,
          ].slice(0, RECENT_LIMIT);
        }

        progress.inserted += slots;
        progress.ticks += 1;
        progress.lastBatchMs = Math.round(performance.now() - t0);
        progress.elapsedMs = Math.round(performance.now() - startedAt);
        progress.docsPerSecond =
          progress.elapsedMs === 0 ? 0 : Math.round((progress.documentsWritten / progress.elapsedMs) * 1000);

        this.emit('progress', { ...progress });

        if (progress.inserted >= plan.target) break;
        await sleep(plan.intervalMs);
      }

      if (progress.status === 'running') progress.status = 'completed';
    } catch (err) {
      progress.status = 'error';
      progress.error = (err as Error).message;
    } finally {
      progress.elapsedMs = Math.round(performance.now() - startedAt);
      progress.finishedAt = new Date().toISOString();
      this.stopFlags.delete(jobId);
      this.emit('progress', { ...progress });
    }
  }
}

async function runOp(
  adapter: DataAdapter,
  op: WorkloadOp,
  n: number,
  req: SimulationRequest,
): Promise<{ documents: number; latencyMs: number; detail: string }> {
  switch (op) {
    case 'insert': {
      const r = await adapter.bulkInsert(buildRequest(req.entity, n, req.inventoryPerPlayer));
      return { documents: r.written, latencyMs: r.latencyMs, detail: `${n} ${req.entity} inserted` };
    }
    case 'read':
      return adapter.readWorkload(n);
    case 'update':
      return adapter.updateWorkload(n);
    case 'delete':
      return adapter.deleteWorkload(n);
  }
}

function buildRequest(entity: SimEntity, batch: number, inventoryPerPlayer: number): BulkInsertRequest {
  switch (entity) {
    case 'players':
      return { players: batch, inventoryPerPlayer, lobbies: 0, matches: 0 };
    case 'lobbies':
      return { players: 0, inventoryPerPlayer: 0, lobbies: batch, matches: 0 };
    case 'matches':
      return { players: 0, inventoryPerPlayer: 0, lobbies: 0, matches: batch };
    case 'mixed': {
      const players = Math.max(1, Math.round(batch * 0.5));
      const lobbies = Math.max(0, Math.round(batch * 0.2));
      return { players, inventoryPerPlayer, lobbies, matches: Math.max(0, batch - players - lobbies) };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const simulation = new SimulationEngine();
export const SIM_LIMITS = { MIN_INTERVAL_MS, MAX_INTERVAL_MS, MAX_AMOUNT };
