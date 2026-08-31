import type { DataAdapter, DataSourceKind } from '../domain/types.js';
import { FirestoreAdapter } from './firestoreAdapter.js';
import { MongoAdapter } from './mongoAdapter.js';

export interface SourceStatus {
  kind: DataSourceKind;
  available: boolean;
  error?: string;
}

const adapters = new Map<DataSourceKind, DataAdapter>();
const failures = new Map<DataSourceKind, string>();

function construct(kind: DataSourceKind): DataAdapter {
  return kind === 'firestore' ? new FirestoreAdapter() : new MongoAdapter();
}

/**
 * Adapters are initialised on first use rather than at boot so the demo still
 * starts when only one of the two backends is reachable.
 */
export async function getAdapter(kind: DataSourceKind): Promise<DataAdapter> {
  const existing = adapters.get(kind);
  if (existing) return existing;

  const adapter = construct(kind);
  try {
    await adapter.init();
  } catch (err) {
    failures.set(kind, (err as Error).message);
    throw err;
  }
  failures.delete(kind);
  adapters.set(kind, adapter);
  return adapter;
}

export async function probeSources(): Promise<SourceStatus[]> {
  const kinds: DataSourceKind[] = ['firestore', 'mongo'];
  return Promise.all(
    kinds.map(async (kind) => {
      try {
        const adapter = await getAdapter(kind);
        const ping = await adapter.ping();
        return ping.ok
          ? { kind, available: true }
          : { kind, available: false, error: ping.detail ?? 'ping failed' };
      } catch (err) {
        return { kind, available: false, error: (err as Error).message };
      }
    }),
  );
}

export async function closeAll(): Promise<void> {
  await Promise.all([...adapters.values()].map((a) => a.close()));
  adapters.clear();
}

export function knownFailure(kind: DataSourceKind): string | undefined {
  return failures.get(kind);
}
