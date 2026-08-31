#!/usr/bin/env tsx
/**
 * Parameterized seeder for Aegis Legends.
 *
 *   npm run seed -- --players 500 --inventory-per-player 8 --lobbies 25 --matches 200
 *   npm run seed -- --source mongo --clear
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run seed -- --players 50
 */
import { getAdapter } from '../adapters/registry.js';
import { env } from '../config/env.js';
import { closeMongo } from '../config/mongo.js';
import type { DataAdapter, DataSourceKind } from '../domain/types.js';

interface Options {
  players: number;
  inventoryPerPlayer: number;
  lobbies: number;
  matches: number;
  batchSize: number;
  clear: boolean;
  source: DataSourceKind;
  quiet: boolean;
}

const DEFAULTS: Options = {
  players: 100,
  inventoryPerPlayer: 5,
  lobbies: 10,
  matches: 50,
  batchSize: 500,
  clear: false,
  source: 'firestore',
  quiet: false,
};

const USAGE = `
Aegis Legends: Galactic Arena - data seeder

Usage: npm run seed -- [flags]

Flags:
  --players <n>                Players to create                 (default ${DEFAULTS.players})
  --inventory-per-player <n>   Inventory docs per player         (default ${DEFAULTS.inventoryPerPlayer})
  --lobbies <n>                Lobbies to create                 (default ${DEFAULTS.lobbies})
  --matches <n>                Historical matches to create      (default ${DEFAULTS.matches})
  --batch-size <n>             Entities per batch, max 500       (default ${DEFAULTS.batchSize})
  --source <firestore|mongo>   Target data store                 (default ${DEFAULTS.source})
  --clear                      Wipe target collections first
  --quiet                      Suppress progress output
  --help                       Show this message
`;

function parseArgs(argv: string[]): Options {
  const opts: Options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };

    switch (arg) {
      case '--players': opts.players = Number(next()); break;
      case '--inventory-per-player': opts.inventoryPerPlayer = Number(next()); break;
      case '--lobbies': opts.lobbies = Number(next()); break;
      case '--matches': opts.matches = Number(next()); break;
      case '--batch-size': opts.batchSize = Number(next()); break;
      case '--source': opts.source = next() === 'mongo' ? 'mongo' : 'firestore'; break;
      case '--clear': opts.clear = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--help': case '-h': console.log(USAGE); process.exit(0); break;
      default: throw new Error(`Unknown flag: ${arg}\n${USAGE}`);
    }
  }

  for (const key of ['players', 'inventoryPerPlayer', 'lobbies', 'matches', 'batchSize'] as const) {
    if (!Number.isFinite(opts[key]) || opts[key] < 0) {
      throw new Error(`--${key} must be a non-negative number`);
    }
  }
  // Firestore commits cap at 500 writes. BulkWriter re-batches internally, but
  // chunking here keeps memory flat and progress reporting truthful.
  opts.batchSize = Math.min(500, Math.max(1, Math.floor(opts.batchSize)));

  return opts;
}

function bar(done: number, total: number, width = 28): string {
  const filled = total === 0 ? width : Math.round((done / total) * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${done}/${total}`;
}

/** Runs one entity kind through the adapter in batchSize-sized chunks. */
async function seedInChunks(
  adapter: DataAdapter,
  label: string,
  total: number,
  batchSize: number,
  quiet: boolean,
  build: (chunk: number) => Parameters<DataAdapter['bulkInsert']>[0],
): Promise<number> {
  if (total === 0) return 0;
  let written = 0;

  for (let done = 0; done < total; done += batchSize) {
    const chunk = Math.min(batchSize, total - done);
    const result = await adapter.bulkInsert(build(chunk));
    written += result.written;
    if (!quiet) process.stdout.write(`\r  ${label.padEnd(11)} ${bar(done + chunk, total)}`);
  }
  if (!quiet) process.stdout.write('\n');

  return written;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const log = (msg: string): void => {
    if (!opts.quiet) console.log(msg);
  };

  log('');
  log('  Aegis Legends: Galactic Arena - seeder');
  log(`  target      : ${opts.source}`);
  if (opts.source === 'firestore') {
    log(`  project/db  : ${env.gcpProjectId || '(from ADC)'} / ${env.firestoreDatabaseId}`);
    if (env.firestoreEmulatorHost) log(`  emulator    : ${env.firestoreEmulatorHost}`);
  } else {
    log(`  mongo uri   : ${env.mongoUri}`);
    log(`  mongo db    : ${env.mongoDb}`);
  }
  log(`  plan        : ${opts.players} players x ${opts.inventoryPerPlayer} items, ${opts.lobbies} lobbies, ${opts.matches} matches`);
  log(`  batch size  : ${opts.batchSize}`);
  log('');

  const adapter = await getAdapter(opts.source);

  if (opts.clear) {
    process.stdout.write('  clearing existing collections ... ');
    const { deleted } = await adapter.clearAll();
    log(`done (${deleted} root docs removed)`);
  }

  const t0 = performance.now();
  let written = 0;

  written += await seedInChunks(adapter, 'players', opts.players, opts.batchSize, opts.quiet, (chunk) => ({
    players: chunk,
    inventoryPerPlayer: opts.inventoryPerPlayer,
    lobbies: 0,
    matches: 0,
  }));

  // Lobbies and matches run after players so their rosters reference real
  // player documents (the adapter samples existing players when a batch
  // creates none of its own).
  written += await seedInChunks(adapter, 'lobbies', opts.lobbies, opts.batchSize, opts.quiet, (chunk) => ({
    players: 0,
    inventoryPerPlayer: 0,
    lobbies: chunk,
    matches: 0,
  }));

  written += await seedInChunks(adapter, 'matches', opts.matches, opts.batchSize, opts.quiet, (chunk) => ({
    players: 0,
    inventoryPerPlayer: 0,
    lobbies: 0,
    matches: chunk,
  }));

  const elapsed = Math.round(performance.now() - t0);
  const agg = await adapter.aggregates();

  log('');
  log(`  wrote ${written} documents in ${elapsed}ms (${Math.round((written / Math.max(1, elapsed)) * 1000)} docs/sec)`);
  log('');
  log('  collection totals now:');
  log(`    players  ${agg.counts.players}`);
  log(`    lobbies  ${agg.counts.lobbies} (${agg.counts.activeLobbies} active)`);
  log(`    matches  ${agg.counts.matches}`);
  log(`    avg mmr  ${agg.avgMmr}  (min ${agg.minMmr} / max ${agg.maxMmr})`);
  log('');

  await closeMongo();
}

main().catch((err: unknown) => {
  console.error(`\nseed failed: ${(err as Error).message}`);
  process.exitCode = 1;
  void closeMongo();
});
