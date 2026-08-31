import type { NextFunction, Request, Response } from 'express';
import { getAdapter } from '../adapters/registry.js';
import { env } from '../config/env.js';
import type { DataAdapter, DataSourceKind } from '../domain/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adapter: DataAdapter;
      source: DataSourceKind;
    }
  }
}

export function resolveSource(req: Request): DataSourceKind {
  const raw =
    (req.query['source'] as string | undefined) ??
    (req.header('x-data-source') ?? undefined) ??
    env.defaultSource;
  return raw === 'mongo' ? 'mongo' : 'firestore';
}

/** Attaches the adapter the caller asked for; 503 if that backend is down. */
export async function withAdapter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const source = resolveSource(req);
  try {
    req.adapter = await getAdapter(source);
    req.source = source;
    res.setHeader('x-data-source', source);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'data_source_unavailable',
      source,
      message: (err as Error).message,
    });
  }
}

export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function strParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
