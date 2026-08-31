import { MongoClient, type AnyBulkWriteOperation, type Db, type Document, type Filter } from 'mongodb';
import { env, redactUri } from '../config/env.js';
import { detectChangeStreamSupport, getMongo } from '../config/mongo.js';
import { CATALOG_BY_ID } from '../domain/catalog.js';
import {
  makeInventory,
  makeLobby,
  makeMatch,
  makePlayer,
  makeScoreboard,
  mmrToRank,
  toSummary,
} from '../domain/generator.js';
import {
  REGIONS,
  type Aggregates,
  type BulkInsertRequest,
  type BulkInsertResult,
  type ConnectionInfo,
  type Counts,
  type DataAdapter,
  type InventoryItem,
  type LeaderboardOptions,
  type LeaderboardRow,
  type ListPlayersOptions,
  type Lobby,
  type LobbyStatus,
  type Match,
  type MatchHistoryOptions,
  type Page,
  type Player,
  type PlayerSummary,
  type PurchaseResult,
  type WorkloadResult,
} from '../domain/types.js';

const C = {
  players: 'players',
  inventory: 'inventory',
  lobbies: 'lobbies',
  matches: 'matches',
} as const;

/** Poll cadence for the pseudo-realtime feed on deployments without change streams. */
const POLL_MS = 1500;

function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): unknown[] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date(0).toISOString();
}

function toPlayer(d: Document): Player {
  return {
    playerId: d['playerId'] as string,
    username: d['username'] as string,
    region: d['region'] as Player['region'],
    level: d['level'] as number,
    rankTier: d['rankTier'] as Player['rankTier'],
    mmr: d['mmr'] as number,
    stats: d['stats'] as Player['stats'],
    currency: d['currency'] as Player['currency'],
    createdAt: iso(d['createdAt']),
    lastLoginAt: iso(d['lastLoginAt']),
  };
}

function toItem(d: Document): InventoryItem {
  return {
    itemId: d['itemId'] as string,
    name: d['name'] as string,
    itemType: d['itemType'] as InventoryItem['itemType'],
    rarity: d['rarity'] as InventoryItem['rarity'],
    powerRating: d['powerRating'] as number,
    isEquipped: Boolean(d['isEquipped']),
    acquiredAt: iso(d['acquiredAt']),
  };
}

function toLobby(d: Document): Lobby {
  return {
    lobbyId: d['lobbyId'] as string,
    gameMode: d['gameMode'] as Lobby['gameMode'],
    status: d['status'] as LobbyStatus,
    maxPlayers: d['maxPlayers'] as number,
    region: d['region'] as Lobby['region'],
    playerList: (d['playerList'] as PlayerSummary[]) ?? [],
    createdAt: iso(d['createdAt']),
    updatedAt: iso(d['updatedAt']),
  };
}

function toMatch(d: Document): Match {
  return {
    matchId: d['matchId'] as string,
    lobbyId: d['lobbyId'] as string,
    gameMode: d['gameMode'] as Match['gameMode'],
    region: d['region'] as Match['region'],
    durationSeconds: d['durationSeconds'] as number,
    winningTeam: d['winningTeam'] as string,
    scoreboard: (d['scoreboard'] as Match['scoreboard']) ?? [],
    timestamp: iso(d['timestamp']),
  };
}

function playerDoc(p: Player): Document {
  return {
    _id: p.playerId,
    ...p,
    usernameLower: p.username.toLowerCase(),
    createdAt: new Date(p.createdAt),
    lastLoginAt: new Date(p.lastLoginAt),
  };
}

function itemDoc(playerId: string, i: InventoryItem): Document {
  return { _id: `${playerId}:${i.itemId}`, playerId, ...i, acquiredAt: new Date(i.acquiredAt) };
}

function lobbyDoc(l: Lobby): Document {
  return {
    _id: l.lobbyId,
    ...l,
    playerIds: l.playerList.map((p) => p.playerId),
    createdAt: new Date(l.createdAt),
    updatedAt: new Date(l.updatedAt),
  };
}

function matchDoc(m: Match): Document {
  return {
    _id: m.matchId,
    ...m,
    participantIds: m.scoreboard.map((s) => s.playerId),
    timestamp: new Date(m.timestamp),
  };
}

export class MongoAdapter implements DataAdapter {
  readonly kind = 'mongo' as const;
  private client!: MongoClient;
  private db!: Db;
  private changeStreams = false;

  async init(): Promise<void> {
    const { client, db } = await getMongo();
    this.client = client;
    this.db = db;
    this.changeStreams = await detectChangeStreamSupport(client);
    await this.ensureIndexes();
  }

  /** Mirrors firestore.indexes.json so both engines answer the same queries fast. */
  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.db.collection(C.players).createIndexes([
        { key: { mmr: -1, 'stats.winRate': -1 } },
        { key: { region: 1, mmr: -1 } },
        { key: { rankTier: 1, mmr: -1 } },
        { key: { region: 1, rankTier: 1, mmr: -1 } },
        { key: { usernameLower: 1 } },
        { key: { lastLoginAt: -1 } },
      ]),
      this.db.collection(C.inventory).createIndexes([
        { key: { playerId: 1, powerRating: -1 } },
        { key: { playerId: 1, itemType: 1, isEquipped: 1 } },
      ]),
      this.db.collection(C.lobbies).createIndexes([
        { key: { status: 1, updatedAt: -1 } },
        { key: { region: 1, status: 1, updatedAt: -1 } },
      ]),
      this.db.collection(C.matches).createIndexes([
        { key: { timestamp: -1 } },
        { key: { participantIds: 1, timestamp: -1 } },
      ]),
    ]);
  }

  async close(): Promise<void> {
    // Connection pool is shared process-wide; closed on shutdown, not per request.
  }

  connectionInfo(): ConnectionInfo {
    const uri = redactUri(env.mongoUri);
    let host = 'unknown';
    try {
      host = new URL(uri.replace('mongodb://', 'http://')).host;
    } catch {
      /* keep default */
    }

    const addresses = [{ label: 'Client target', value: host }];
    if (env.mongoInternalIp) addresses.push({ label: 'VM internal IP', value: `${env.mongoInternalIp}:27017` });
    if (env.mongoExternalIp) addresses.push({ label: 'VM external IP', value: `${env.mongoExternalIp}:27017` });

    return {
      source: 'mongo',
      displayName: `MongoDB — ${env.mongoHostLabel}`,
      connectionString: uri,
      host,
      addresses,
      database: env.mongoDb,
      details: [
        { label: 'Host label', value: env.mongoHostLabel },
        { label: 'Database', value: env.mongoDb },
        { label: 'Transport', value: 'IAP TCP tunnel → 27017' },
        { label: 'Deployment', value: this.changeStreams ? 'replica set' : 'standalone' },
        { label: 'Transactions', value: this.changeStreams ? 'multi-document' : 'single-document atomic ops' },
        { label: 'Change streams', value: this.changeStreams ? 'enabled' : 'unavailable (needs replica set)' },
      ],
      supportsChangeStream: this.changeStreams,
      realtimeMechanism: this.changeStreams
        ? 'change streams (server push)'
        : `client polling every ${POLL_MS}ms (standalone mongod has no oplog tailing)`,
    };
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const t0 = performance.now();
    try {
      await this.db.command({ ping: 1 });
      return { ok: true, latencyMs: Math.round(performance.now() - t0) };
    } catch (err) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), detail: (err as Error).message };
    }
  }

  // ---------------------------------------------------------------- players

  async listPlayers(opts: ListPlayersOptions): Promise<Page<Player>> {
    const search = opts.search?.trim().toLowerCase();
    const filter: Filter<Document> = {};
    if (opts.region) filter['region'] = opts.region;
    if (opts.rankTier) filter['rankTier'] = opts.rankTier;

    const cursorValues = decodeCursor(opts.cursor);
    let sort: Document;

    if (search) {
      filter['usernameLower'] = { $regex: `^${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
      sort = { usernameLower: 1 };
      if (cursorValues) filter['usernameLower'] = { ...filter['usernameLower'], $gt: cursorValues[0] };
    } else {
      // Descending _id tiebreaker mirrors Firestore's implicit __name__ order,
      // so a cursor means the same thing on both engines.
      sort = { mmr: -1, _id: -1 };
      if (cursorValues) {
        const [mmr, id] = cursorValues as [number, string];
        filter['$or'] = [{ mmr: { $lt: mmr } }, { mmr, _id: { $lt: id as never } }];
      }
    }

    const docs = await this.db
      .collection(C.players)
      .find(filter)
      .sort(sort)
      .limit(opts.limit + 1)
      .toArray();

    const page = docs.slice(0, opts.limit);
    const hasMore = docs.length > opts.limit;
    const last = page.at(-1);

    let nextCursor: string | null = null;
    if (hasMore && last) {
      nextCursor = search
        ? encodeCursor([last['usernameLower']])
        : encodeCursor([last['mmr'], last['_id']]);
    }

    return { items: page.map(toPlayer), nextCursor, hasMore };
  }

  async getPlayer(playerId: string): Promise<Player | null> {
    const d = await this.db.collection(C.players).findOne({ _id: playerId as never });
    return d ? toPlayer(d) : null;
  }

  async getInventory(playerId: string): Promise<InventoryItem[]> {
    const docs = await this.db
      .collection(C.inventory)
      .find({ playerId })
      .sort({ powerRating: -1 })
      .toArray();
    return docs.map(toItem);
  }

  async equipItem(playerId: string, itemId: string, equip: boolean): Promise<InventoryItem | null> {
    const coll = this.db.collection(C.inventory);
    const target = await coll.findOne({ playerId, itemId });
    if (!target) return null;

    if (equip) {
      await coll.updateMany(
        { playerId, itemType: target['itemType'], isEquipped: true },
        { $set: { isEquipped: false } },
      );
    }
    await coll.updateOne({ playerId, itemId }, { $set: { isEquipped: equip } });
    return { ...toItem(target), isEquipped: equip };
  }

  // ------------------------------------------------------------ leaderboard

  async leaderboard(opts: LeaderboardOptions): Promise<LeaderboardRow[]> {
    const filter: Filter<Document> = {};
    if (opts.region) filter['region'] = opts.region;
    if (opts.rankTier) filter['rankTier'] = opts.rankTier;

    const docs = await this.db
      .collection(C.players)
      .find(filter)
      .sort({ mmr: -1, 'stats.winRate': -1 })
      .limit(opts.limit)
      .toArray();

    return docs.map((d, i) => ({ ...toPlayer(d), rank: i + 1 }));
  }

  // ---------------------------------------------------------------- lobbies

  async listLobbies(status?: LobbyStatus): Promise<Lobby[]> {
    const filter: Filter<Document> = status ? { status } : {};
    const docs = await this.db.collection(C.lobbies).find(filter).sort({ updatedAt: -1 }).limit(60).toArray();
    return docs.map(toLobby);
  }

  async getLobby(lobbyId: string): Promise<Lobby | null> {
    const d = await this.db.collection(C.lobbies).findOne({ _id: lobbyId as never });
    return d ? toLobby(d) : null;
  }

  /**
   * Single round-trip conditional update. The filter carries every precondition
   * (still waiting, not full, player absent), so concurrent joins cannot
   * oversubscribe a lobby even without multi-document transactions.
   */
  async joinLobby(lobbyId: string, playerId: string): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }> {
    const player = await this.getPlayer(playerId);
    if (!player) return { ok: false, reason: 'player_not_found' };

    const existing = await this.getLobby(lobbyId);
    if (!existing) return { ok: false, reason: 'lobby_not_found' };
    if (existing.status !== 'waiting') return { ok: false, reason: 'lobby_not_joinable', lobby: existing };
    if (existing.playerList.some((p) => p.playerId === playerId)) {
      return { ok: false, reason: 'already_joined', lobby: existing };
    }
    if (existing.playerList.length >= existing.maxPlayers) return { ok: false, reason: 'lobby_full', lobby: existing };

    const now = new Date();
    const updated = await this.db.collection(C.lobbies).findOneAndUpdate(
      {
        _id: lobbyId as never,
        status: 'waiting',
        playerIds: { $ne: playerId },
        [`playerList.${existing.maxPlayers - 1}`]: { $exists: false },
      },
      {
        $push: { playerList: toSummary(player) as never, playerIds: playerId as never },
        $set: { updatedAt: now },
      },
      { returnDocument: 'after' },
    );

    if (!updated) return { ok: false, reason: 'join_conflict', lobby: existing };

    const lobby = toLobby(updated);
    if (lobby.playerList.length >= lobby.maxPlayers) {
      await this.db
        .collection(C.lobbies)
        .updateOne({ _id: lobbyId as never }, { $set: { status: 'in_progress', updatedAt: now } });
      lobby.status = 'in_progress';
    }
    return { ok: true, lobby };
  }

  async leaveLobby(lobbyId: string, playerId: string): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }> {
    const updated = await this.db.collection(C.lobbies).findOneAndUpdate(
      { _id: lobbyId as never, playerIds: playerId },
      {
        $pull: { playerList: { playerId } as never, playerIds: playerId as never },
        $set: { status: 'waiting', updatedAt: new Date() },
      },
      { returnDocument: 'after' },
    );
    if (!updated) return { ok: false, reason: 'not_in_lobby' };
    return { ok: true, lobby: toLobby(updated) };
  }

  async completeMatch(lobbyId: string): Promise<{ ok: boolean; reason?: string; match?: Match }> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: 'lobby_not_found' };
    if (lobby.status === 'completed') return { ok: false, reason: 'already_completed' };
    if (lobby.playerList.length === 0) return { ok: false, reason: 'empty_lobby' };

    const winningTeam = Math.random() < 0.5 ? 'Alpha' : 'Bravo';
    const roster = lobby.playerList.slice(0, 12);
    const scoreboard = makeScoreboard(roster, winningTeam);
    const now = new Date();

    const match: Match = {
      matchId: crypto.randomUUID(),
      lobbyId,
      gameMode: lobby.gameMode,
      region: lobby.region,
      durationSeconds: 180 + Math.floor(Math.random() * 2000),
      winningTeam,
      scoreboard,
      timestamp: now.toISOString(),
    };

    // Claim the lobby first; if another caller already closed it we abort
    // before writing a duplicate match document.
    const claimed = await this.db
      .collection(C.lobbies)
      .updateOne({ _id: lobbyId as never, status: { $ne: 'completed' } }, { $set: { status: 'completed', updatedAt: now } });
    if (claimed.modifiedCount === 0) return { ok: false, reason: 'already_completed' };

    await this.db.collection(C.matches).insertOne(matchDoc(match) as never);

    const ops: AnyBulkWriteOperation<Document>[] = scoreboard.map((entry) => {
      const won = entry.mmrDelta > 0;
      return {
        updateOne: {
          filter: { _id: entry.playerId as never },
          update: {
            $inc: {
              mmr: entry.mmrDelta,
              'stats.kills': entry.kills,
              'stats.deaths': entry.deaths,
              'stats.wins': won ? 1 : 0,
              'stats.losses': won ? 0 : 1,
            },
            $set: { lastLoginAt: now },
          },
        },
      };
    });
    if (ops.length > 0) await this.db.collection(C.players).bulkWrite(ops);

    // winRate is derived, so recompute it from the freshly incremented totals.
    await this.db.collection(C.players).updateMany(
      { _id: { $in: scoreboard.map((s) => s.playerId) as never[] } },
      [
        {
          $set: {
            mmr: { $max: [800, { $min: [3200, '$mmr'] }] },
            'stats.winRate': {
              $round: [
                {
                  $cond: [
                    { $eq: [{ $add: ['$stats.wins', '$stats.losses'] }, 0] },
                    0,
                    { $divide: ['$stats.wins', { $add: ['$stats.wins', '$stats.losses'] }] },
                  ],
                },
                3,
              ],
            },
          },
        },
      ],
    );

    return { ok: true, match };
  }

  // ---------------------------------------------------------------- matches

  async matchHistory(opts: MatchHistoryOptions): Promise<Page<Match>> {
    const filter: Filter<Document> = {};
    if (opts.playerId) filter['participantIds'] = opts.playerId;

    const cursorValues = decodeCursor(opts.cursor);
    if (cursorValues) {
      const [isoTs, id] = cursorValues as [string, string];
      const at = new Date(isoTs);
      filter['$or'] = [{ timestamp: { $lt: at } }, { timestamp: at, _id: { $lt: id as never } }];
    }

    const docs = await this.db
      .collection(C.matches)
      .find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .limit(opts.limit + 1)
      .toArray();

    const page = docs.slice(0, opts.limit);
    const hasMore = docs.length > opts.limit;
    const last = page.at(-1);

    return {
      items: page.map(toMatch),
      nextCursor: hasMore && last ? encodeCursor([iso(last['timestamp']), last['_id']]) : null,
      hasMore,
    };
  }

  // ------------------------------------------------------------- aggregates

  async aggregates(): Promise<Aggregates> {
    const t0 = performance.now();
    const players = this.db.collection(C.players);
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [overall, byRegionRaw, playerCount, lobbyCount, activeLobbies, matchCount, online] = await Promise.all([
      players
        .aggregate([
          {
            $group: {
              _id: null,
              avgMmr: { $avg: '$mmr' },
              maxMmr: { $max: '$mmr' },
              minMmr: { $min: '$mmr' },
              sumCredits: { $sum: '$currency.credits' },
            },
          },
        ])
        .toArray(),
      players
        .aggregate([
          { $group: { _id: '$region', players: { $sum: 1 }, avgMmr: { $avg: '$mmr' } } },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      players.countDocuments({}),
      this.db.collection(C.lobbies).countDocuments({}),
      this.db.collection(C.lobbies).countDocuments({ status: { $in: ['waiting', 'in_progress'] } }),
      this.db.collection(C.matches).countDocuments({}),
      players.countDocuments({ lastLoginAt: { $gte: dayAgo } }),
    ]);

    const o = overall[0] ?? {};
    const regionMap = new Map(byRegionRaw.map((r) => [r['_id'] as string, r]));

    const counts: Counts = {
      players: playerCount,
      lobbies: lobbyCount,
      matches: matchCount,
      activeLobbies,
      playersOnline: online,
    };

    return {
      counts,
      avgMmr: Math.round((o['avgMmr'] as number) ?? 0),
      maxMmr: (o['maxMmr'] as number) ?? 0,
      minMmr: (o['minMmr'] as number) ?? 0,
      sumCredits: (o['sumCredits'] as number) ?? 0,
      byRegion: REGIONS.map((region) => ({
        region,
        players: (regionMap.get(region)?.['players'] as number) ?? 0,
        avgMmr: Math.round((regionMap.get(region)?.['avgMmr'] as number) ?? 0),
      })),
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  // --------------------------------------------------------------- purchase

  async purchaseItem(playerId: string, catalogItemId: string): Promise<PurchaseResult> {
    const t0 = performance.now();
    const item = CATALOG_BY_ID.get(catalogItemId);
    if (!item) {
      return { ok: false, reason: 'unknown_item', playerId, latencyMs: Math.round(performance.now() - t0) };
    }

    const owned: InventoryItem = {
      itemId: `${item.catalogId}_${crypto.randomUUID().slice(0, 6)}`,
      name: item.name,
      itemType: item.itemType,
      rarity: item.rarity,
      powerRating: item.powerRating,
      isEquipped: false,
      acquiredAt: new Date().toISOString(),
    };

    if (this.changeStreams) {
      return this.purchaseWithTransaction(playerId, item.priceCredits, item.pricePlasmaCores, owned, t0);
    }

    // Standalone mongod: no multi-document transactions. The debit is still
    // atomic because the balance preconditions live in the update filter, and
    // the item insert is compensated if it fails.
    const before = await this.db.collection(C.players).findOneAndUpdate(
      {
        _id: playerId as never,
        'currency.credits': { $gte: item.priceCredits },
        'currency.plasmaCores': { $gte: item.pricePlasmaCores },
      },
      { $inc: { 'currency.credits': -item.priceCredits, 'currency.plasmaCores': -item.pricePlasmaCores } },
      { returnDocument: 'before' },
    );

    if (!before) {
      const exists = await this.getPlayer(playerId);
      return {
        ok: false,
        reason: exists ? 'insufficient_credits' : 'player_not_found',
        playerId,
        creditsBefore: exists?.currency.credits,
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    const creditsBefore = (before['currency'] as Player['currency']).credits;

    try {
      await this.db.collection(C.inventory).insertOne(itemDoc(playerId, owned) as never);
    } catch (err) {
      await this.db.collection(C.players).updateOne(
        { _id: playerId as never },
        { $inc: { 'currency.credits': item.priceCredits, 'currency.plasmaCores': item.pricePlasmaCores } },
      );
      return {
        ok: false,
        reason: `item_write_failed_refunded: ${(err as Error).message}`,
        playerId,
        creditsBefore,
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    return {
      ok: true,
      playerId,
      item: owned,
      creditsBefore,
      creditsAfter: creditsBefore - item.priceCredits,
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  private async purchaseWithTransaction(
    playerId: string,
    priceCredits: number,
    pricePlasma: number,
    owned: InventoryItem,
    t0: number,
  ): Promise<PurchaseResult> {
    const session = this.client.startSession();
    try {
      let creditsBefore = 0;
      let reason: string | undefined;

      await session.withTransaction(async () => {
        const player = await this.db.collection(C.players).findOne({ _id: playerId as never }, { session });
        if (!player) {
          reason = 'player_not_found';
          await session.abortTransaction();
          return;
        }
        const currency = player['currency'] as Player['currency'];
        creditsBefore = currency.credits;
        if (currency.credits < priceCredits || currency.plasmaCores < pricePlasma) {
          reason = 'insufficient_credits';
          await session.abortTransaction();
          return;
        }
        await this.db
          .collection(C.players)
          .updateOne(
            { _id: playerId as never },
            { $inc: { 'currency.credits': -priceCredits, 'currency.plasmaCores': -pricePlasma } },
            { session },
          );
        await this.db.collection(C.inventory).insertOne(itemDoc(playerId, owned) as never, { session });
      });

      if (reason) {
        return { ok: false, reason, playerId, creditsBefore, latencyMs: Math.round(performance.now() - t0) };
      }
      return {
        ok: true,
        playerId,
        item: owned,
        creditsBefore,
        creditsAfter: creditsBefore - priceCredits,
        latencyMs: Math.round(performance.now() - t0),
      };
    } finally {
      await session.endSession();
    }
  }

  // ------------------------------------------------------------ bulk writes

  async bulkInsert(req: BulkInsertRequest): Promise<BulkInsertResult> {
    const t0 = performance.now();
    const playerOps: AnyBulkWriteOperation<Document>[] = [];
    const invOps: AnyBulkWriteOperation<Document>[] = [];
    const lobbyOps: AnyBulkWriteOperation<Document>[] = [];
    const matchOps: AnyBulkWriteOperation<Document>[] = [];

    const summaries: PlayerSummary[] = [];
    let written = 0;

    for (let i = 0; i < req.players; i++) {
      const player = makePlayer();
      summaries.push(toSummary(player));
      playerOps.push({ insertOne: { document: playerDoc(player) } });
      written++;
      for (const item of makeInventory(req.inventoryPerPlayer)) {
        invOps.push({ insertOne: { document: itemDoc(player.playerId, item) } });
        written++;
      }
    }

    let candidates = summaries;
    if (candidates.length === 0 && (req.lobbies > 0 || req.matches > 0)) {
      const existing = await this.db.collection(C.players).find({}).limit(120).toArray();
      candidates = existing.map((d) => toSummary(toPlayer(d)));
    }

    const lobbies: Lobby[] = [];
    for (let i = 0; i < req.lobbies; i++) {
      const lobby = makeLobby(candidates);
      lobbies.push(lobby);
      lobbyOps.push({ insertOne: { document: lobbyDoc(lobby) } });
      written++;
    }

    for (let i = 0; i < req.matches; i++) {
      const source = lobbies[i % Math.max(1, lobbies.length)] ?? makeLobby(candidates, 'completed');
      matchOps.push({ insertOne: { document: matchDoc(makeMatch(source)) } });
      written++;
    }

    await Promise.all([
      playerOps.length ? this.db.collection(C.players).bulkWrite(playerOps, { ordered: false }) : null,
      invOps.length ? this.db.collection(C.inventory).bulkWrite(invOps, { ordered: false }) : null,
      lobbyOps.length ? this.db.collection(C.lobbies).bulkWrite(lobbyOps, { ordered: false }) : null,
      matchOps.length ? this.db.collection(C.matches).bulkWrite(matchOps, { ordered: false }) : null,
    ]);

    const latencyMs = Math.round(performance.now() - t0);
    return {
      written,
      breakdown: {
        players: req.players,
        inventory: req.players * req.inventoryPerPlayer,
        lobbies: req.lobbies,
        matches: req.matches,
      },
      latencyMs,
      docsPerSecond: latencyMs === 0 ? written : Math.round((written / latencyMs) * 1000),
    };
  }

  async clearAll(): Promise<{ deleted: number }> {
    const counts = await Promise.all([
      this.db.collection(C.players).countDocuments({}),
      this.db.collection(C.lobbies).countDocuments({}),
      this.db.collection(C.matches).countDocuments({}),
    ]);
    await Promise.all([
      this.db.collection(C.players).deleteMany({}),
      this.db.collection(C.inventory).deleteMany({}),
      this.db.collection(C.lobbies).deleteMany({}),
      this.db.collection(C.matches).deleteMany({}),
    ]);
    return { deleted: counts.reduce((a, b) => a + b, 0) };
  }

  // ------------------------------------------------------- workload drivers

  /** $sample is the server-side random pick; no client-side offset scanning. */
  private async randomPlayers(n: number): Promise<Document[]> {
    if (n <= 0) return [];
    return this.db
      .collection(C.players)
      .aggregate([{ $sample: { size: n } }])
      .toArray();
  }

  async readWorkload(count: number): Promise<WorkloadResult> {
    const t0 = performance.now();
    let documents = 0;
    const kinds: string[] = [];

    for (let i = 0; i < count; i++) {
      switch (i % 3) {
        case 0: {
          const [pick] = await this.randomPlayers(1);
          if (pick) {
            documents += 1;
            const inv = await this.db
              .collection(C.inventory)
              .find({ playerId: pick['playerId'] })
              .limit(10)
              .toArray();
            documents += inv.length;
          }
          kinds.push('point+inventory');
          break;
        }
        case 1: {
          const region = REGIONS[Math.floor(Math.random() * REGIONS.length)] as string;
          const docs = await this.db
            .collection(C.players)
            .find({ region })
            .sort({ mmr: -1 })
            .limit(25)
            .toArray();
          documents += docs.length;
          kinds.push(`leaderboard:${region}`);
          break;
        }
        default: {
          const region = REGIONS[Math.floor(Math.random() * REGIONS.length)] as string;
          const n = await this.db.collection(C.players).countDocuments({ region });
          documents += n > 0 ? 1 : 0;
          kinds.push(`count:${region}`);
          break;
        }
      }
    }

    return {
      documents,
      latencyMs: Math.round(performance.now() - t0),
      detail: `${count} reads (${[...new Set(kinds)].join(', ')})`,
    };
  }

  async updateWorkload(count: number): Promise<WorkloadResult> {
    const t0 = performance.now();
    const picks = await this.randomPlayers(count);
    if (picks.length === 0) {
      return { documents: 0, latencyMs: Math.round(performance.now() - t0), detail: 'no players to update' };
    }

    const now = new Date();
    const ops: AnyBulkWriteOperation<Document>[] = picks.map((p) => {
      const drift = Math.floor(Math.random() * 41) - 20;
      const next = Math.max(800, Math.min(3200, ((p['mmr'] as number) ?? 1500) + drift));
      return {
        updateOne: {
          filter: { _id: p['_id'] as never },
          update: {
            $set: { mmr: next, rankTier: mmrToRank(next), lastLoginAt: now },
            $inc: {
              'currency.credits': Math.floor(Math.random() * 500),
              'stats.totalPlaytimeHours': 0.1,
            },
          },
        },
      };
    });

    const result = await this.db.collection(C.players).bulkWrite(ops, { ordered: false });

    return {
      documents: result.modifiedCount,
      latencyMs: Math.round(performance.now() - t0),
      detail: `${result.modifiedCount} players updated (mmr drift, credits, session time)`,
    };
  }

  async deleteWorkload(count: number): Promise<WorkloadResult> {
    const t0 = performance.now();

    // Oldest matches first, then closed lobbies. Players are never deleted so a
    // long mixed run does not starve the read and update paths.
    const matches = await this.db
      .collection(C.matches)
      .find({}, { projection: { _id: 1 } })
      .sort({ timestamp: 1 })
      .limit(count)
      .toArray();

    let matchesDeleted = 0;
    if (matches.length > 0) {
      const r = await this.db
        .collection(C.matches)
        .deleteMany({ _id: { $in: matches.map((m) => m['_id']) as never[] } });
      matchesDeleted = r.deletedCount;
    }

    let lobbiesDeleted = 0;
    const remaining = count - matchesDeleted;
    if (remaining > 0) {
      const lobbies = await this.db
        .collection(C.lobbies)
        .find({ status: 'completed' }, { projection: { _id: 1 } })
        .limit(remaining)
        .toArray();
      if (lobbies.length > 0) {
        const r = await this.db
          .collection(C.lobbies)
          .deleteMany({ _id: { $in: lobbies.map((l) => l['_id']) as never[] } });
        lobbiesDeleted = r.deletedCount;
      }
    }

    const total = matchesDeleted + lobbiesDeleted;
    return {
      documents: total,
      latencyMs: Math.round(performance.now() - t0),
      detail:
        total === 0
          ? 'nothing left to delete (no matches or completed lobbies)'
          : `${matchesDeleted} matches, ${lobbiesDeleted} completed lobbies deleted`,
    };
  }

  // --------------------------------------------------------------- realtime

  subscribeLobbies(onChange: (lobbies: Lobby[]) => void): () => void {
    return this.poll(
      () => this.listLobbies().then((all) => all.filter((l) => l.status !== 'completed')),
      onChange,
    );
  }

  subscribeLeaderboard(limit: number, onChange: (rows: LeaderboardRow[]) => void): () => void {
    return this.poll(() => this.leaderboard({ limit }), onChange);
  }

  /**
   * Emits only when the payload actually changed, so a polled source produces
   * the same event shape a change stream would.
   */
  private poll<T>(fetch: () => Promise<T>, onChange: (value: T) => void): () => void {
    let stopped = false;
    let lastHash = '';

    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const value = await fetch();
        const hash = JSON.stringify(value);
        if (hash !== lastHash) {
          lastHash = hash;
          onChange(value);
        }
      } catch (err) {
        console.error('[mongo] poll error:', (err as Error).message);
      }
    };

    void tick();
    const handle = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }
}
