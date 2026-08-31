import {
  AggregateField,
  BulkWriter,
  FieldValue,
  Firestore,
  Query,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from '@google-cloud/firestore';
import { env } from '../config/env.js';
import { firestoreEndpoint, getFirestore, type FirestoreIdentity } from '../config/firestore.js';
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
  type Region,
  type WorkloadResult,
} from '../domain/types.js';

const C = {
  players: 'players',
  inventory: 'inventory',
  lobbies: 'lobbies',
  matches: 'matches',
  leaderboards: 'leaderboards',
} as const;

function toIso(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return new Date(0).toISOString();
}

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

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

function docToPlayer(snap: QueryDocumentSnapshot | DocumentData, id?: string): Player {
  const d = (typeof (snap as QueryDocumentSnapshot).data === 'function'
    ? (snap as QueryDocumentSnapshot).data()
    : snap) as DocumentData;
  return {
    playerId: (d['playerId'] as string) ?? id ?? '',
    username: d['username'] as string,
    region: d['region'] as Region,
    level: d['level'] as number,
    rankTier: d['rankTier'] as Player['rankTier'],
    mmr: d['mmr'] as number,
    stats: d['stats'] as Player['stats'],
    currency: d['currency'] as Player['currency'],
    createdAt: toIso(d['createdAt']),
    lastLoginAt: toIso(d['lastLoginAt']),
  };
}

function docToItem(d: DocumentData): InventoryItem {
  return {
    itemId: d['itemId'] as string,
    name: d['name'] as string,
    itemType: d['itemType'] as InventoryItem['itemType'],
    rarity: d['rarity'] as InventoryItem['rarity'],
    powerRating: d['powerRating'] as number,
    isEquipped: Boolean(d['isEquipped']),
    acquiredAt: toIso(d['acquiredAt']),
  };
}

function docToLobby(d: DocumentData): Lobby {
  return {
    lobbyId: d['lobbyId'] as string,
    gameMode: d['gameMode'] as Lobby['gameMode'],
    status: d['status'] as LobbyStatus,
    maxPlayers: d['maxPlayers'] as number,
    region: d['region'] as Region,
    playerList: (d['playerList'] as PlayerSummary[]) ?? [],
    createdAt: toIso(d['createdAt']),
    updatedAt: toIso(d['updatedAt']),
  };
}

function docToMatch(d: DocumentData): Match {
  return {
    matchId: d['matchId'] as string,
    lobbyId: d['lobbyId'] as string,
    gameMode: d['gameMode'] as Match['gameMode'],
    region: d['region'] as Region,
    durationSeconds: d['durationSeconds'] as number,
    winningTeam: d['winningTeam'] as string,
    scoreboard: (d['scoreboard'] as Match['scoreboard']) ?? [],
    timestamp: toIso(d['timestamp']),
  };
}

function playerToDoc(p: Player): DocumentData {
  return {
    ...p,
    // Denormalised for case-insensitive prefix search; Firestore has no LIKE.
    usernameLower: p.username.toLowerCase(),
    createdAt: ts(p.createdAt),
    lastLoginAt: ts(p.lastLoginAt),
  };
}

function itemToDoc(i: InventoryItem): DocumentData {
  return { ...i, acquiredAt: ts(i.acquiredAt) };
}

function lobbyToDoc(l: Lobby): DocumentData {
  return {
    ...l,
    playerIds: l.playerList.map((p) => p.playerId),
    createdAt: ts(l.createdAt),
    updatedAt: ts(l.updatedAt),
  };
}

function matchToDoc(m: Match): DocumentData {
  return {
    ...m,
    // array-contains target: you cannot query inside an array of maps.
    participantIds: m.scoreboard.map((s) => s.playerId),
    timestamp: ts(m.timestamp),
  };
}

export class FirestoreAdapter implements DataAdapter {
  readonly kind = 'firestore' as const;
  private db!: Firestore;
  private identity!: FirestoreIdentity;

  async init(): Promise<void> {
    const { db, identity } = await getFirestore();
    this.db = db;
    this.identity = identity;
  }

  async close(): Promise<void> {
    // The Firestore client pools gRPC channels and is reused for process life.
  }

  connectionInfo(): ConnectionInfo {
    const endpoint = firestoreEndpoint(this.identity);
    return {
      source: 'firestore',
      displayName: 'Google Cloud Firestore (Native)',
      connectionString: this.identity.usingEmulator
        ? `firestore://${env.firestoreEmulatorHost}/${this.identity.projectId}/${this.identity.databaseId}`
        : `projects/${this.identity.projectId}/databases/${this.identity.databaseId}`,
      host: endpoint,
      addresses: [
        { label: 'Endpoint', value: endpoint },
        { label: 'Location', value: 'us-central1' },
      ],
      database: this.identity.databaseId,
      details: [
        { label: 'Project', value: this.identity.projectId },
        { label: 'Database ID', value: this.identity.databaseId },
        { label: 'Mode', value: 'Native' },
        { label: 'Auth', value: `ADC / ${this.identity.credentialType}` },
        { label: 'Principal', value: this.identity.principal },
        { label: 'IAM role', value: 'roles/datastore.user' },
        { label: 'Emulator', value: this.identity.usingEmulator ? env.firestoreEmulatorHost : 'disabled' },
      ],
      supportsChangeStream: true,
      realtimeMechanism: 'onSnapshot listeners (server push over gRPC)',
    };
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const t0 = performance.now();
    try {
      await this.db.collection(C.players).limit(1).get();
      return { ok: true, latencyMs: Math.round(performance.now() - t0) };
    } catch (err) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), detail: (err as Error).message };
    }
  }

  // ---------------------------------------------------------------- players

  async listPlayers(opts: ListPlayersOptions): Promise<Page<Player>> {
    const search = opts.search?.trim().toLowerCase();
    let q: Query = this.db.collection(C.players);

    if (opts.region) q = q.where('region', '==', opts.region);
    if (opts.rankTier) q = q.where('rankTier', '==', opts.rankTier);

    if (search) {
      // Prefix range scan:  sorts after any normal character.
      q = q
        .where('usernameLower', '>=', search)
        .where('usernameLower', '<', `${search}`)
        .orderBy('usernameLower', 'asc');
    } else {
      // __name__ must be declared to be usable as a cursor value, and must
      // descend alongside mmr — an ascending tiebreaker would need its own
      // composite index for every filter combination.
      q = q.orderBy('mmr', 'desc').orderBy('__name__', 'desc');
    }

    const cursorValues = decodeCursor(opts.cursor);
    if (cursorValues) q = q.startAfter(...cursorValues);

    const snap = await q.limit(opts.limit + 1).get();
    const docs = snap.docs.slice(0, opts.limit);
    const hasMore = snap.docs.length > opts.limit;
    const last = docs.at(-1);

    let nextCursor: string | null = null;
    if (hasMore && last) {
      nextCursor = search
        ? encodeCursor([last.get('usernameLower')])
        : encodeCursor([last.get('mmr'), last.id]);
    }

    return { items: docs.map((d) => docToPlayer(d, d.id)), nextCursor, hasMore };
  }

  async getPlayer(playerId: string): Promise<Player | null> {
    const snap = await this.db.collection(C.players).doc(playerId).get();
    if (!snap.exists) return null;
    return docToPlayer(snap.data() as DocumentData, snap.id);
  }

  async getInventory(playerId: string): Promise<InventoryItem[]> {
    const snap = await this.db
      .collection(C.players)
      .doc(playerId)
      .collection(C.inventory)
      .orderBy('powerRating', 'desc')
      .get();
    return snap.docs.map((d) => docToItem(d.data()));
  }

  async equipItem(playerId: string, itemId: string, equip: boolean): Promise<InventoryItem | null> {
    const invRef = this.db.collection(C.players).doc(playerId).collection(C.inventory);

    return this.db.runTransaction(async (tx) => {
      const target = await tx.get(invRef.doc(itemId));
      if (!target.exists) return null;
      const item = docToItem(target.data() as DocumentData);

      if (equip) {
        // Only one item of a given slot may be equipped at a time.
        const sameSlot = await tx.get(invRef.where('itemType', '==', item.itemType).where('isEquipped', '==', true));
        for (const d of sameSlot.docs) tx.update(d.ref, { isEquipped: false });
      }
      tx.update(target.ref, { isEquipped: equip });
      return { ...item, isEquipped: equip };
    });
  }

  // ------------------------------------------------------------ leaderboard

  async leaderboard(opts: LeaderboardOptions): Promise<LeaderboardRow[]> {
    let q: Query = this.db.collection(C.players);
    if (opts.region) q = q.where('region', '==', opts.region);
    if (opts.rankTier) q = q.where('rankTier', '==', opts.rankTier);

    const snap = await q.orderBy('mmr', 'desc').orderBy('stats.winRate', 'desc').limit(opts.limit).get();
    return snap.docs.map((d, i) => ({ ...docToPlayer(d, d.id), rank: i + 1 }));
  }

  // ---------------------------------------------------------------- lobbies

  async listLobbies(status?: LobbyStatus): Promise<Lobby[]> {
    let q: Query = this.db.collection(C.lobbies);
    if (status) q = q.where('status', '==', status);
    const snap = await q.orderBy('updatedAt', 'desc').limit(60).get();
    return snap.docs.map((d) => docToLobby(d.data()));
  }

  async getLobby(lobbyId: string): Promise<Lobby | null> {
    const snap = await this.db.collection(C.lobbies).doc(lobbyId).get();
    return snap.exists ? docToLobby(snap.data() as DocumentData) : null;
  }

  async joinLobby(lobbyId: string, playerId: string): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }> {
    const lobbyRef = this.db.collection(C.lobbies).doc(lobbyId);
    const playerRef = this.db.collection(C.players).doc(playerId);

    return this.db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(lobbyRef, playerRef);
      const lobbySnap = snaps[0];
      const playerSnap = snaps[1];
      if (!lobbySnap?.exists) return { ok: false, reason: 'lobby_not_found' };
      if (!playerSnap?.exists) return { ok: false, reason: 'player_not_found' };

      const lobby = docToLobby(lobbySnap.data() as DocumentData);
      if (lobby.status !== 'waiting') return { ok: false, reason: 'lobby_not_joinable', lobby };
      if (lobby.playerList.length >= lobby.maxPlayers) return { ok: false, reason: 'lobby_full', lobby };
      if (lobby.playerList.some((p) => p.playerId === playerId)) return { ok: false, reason: 'already_joined', lobby };

      const summary = toSummary(docToPlayer(playerSnap.data() as DocumentData, playerSnap.id));
      const playerList = [...lobby.playerList, summary];
      const status: LobbyStatus = playerList.length >= lobby.maxPlayers ? 'in_progress' : 'waiting';
      const updatedAt = new Date().toISOString();

      tx.update(lobbyRef, {
        playerList,
        playerIds: FieldValue.arrayUnion(playerId),
        status,
        updatedAt: ts(updatedAt),
      });

      return { ok: true, lobby: { ...lobby, playerList, status, updatedAt } };
    });
  }

  async leaveLobby(lobbyId: string, playerId: string): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }> {
    const lobbyRef = this.db.collection(C.lobbies).doc(lobbyId);

    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(lobbyRef);
      if (!snap.exists) return { ok: false, reason: 'lobby_not_found' };

      const lobby = docToLobby(snap.data() as DocumentData);
      const playerList = lobby.playerList.filter((p) => p.playerId !== playerId);
      if (playerList.length === lobby.playerList.length) return { ok: false, reason: 'not_in_lobby', lobby };

      const updatedAt = new Date().toISOString();
      tx.update(lobbyRef, {
        playerList,
        playerIds: FieldValue.arrayRemove(playerId),
        status: 'waiting',
        updatedAt: ts(updatedAt),
      });

      return { ok: true, lobby: { ...lobby, playerList, status: 'waiting', updatedAt } };
    });
  }

  /**
   * Closes a lobby and writes the resulting match, applying every player's MMR
   * delta in the same transaction so the leaderboard can never disagree with
   * the match record.
   */
  async completeMatch(lobbyId: string): Promise<{ ok: boolean; reason?: string; match?: Match }> {
    const lobbyRef = this.db.collection(C.lobbies).doc(lobbyId);

    return this.db.runTransaction(async (tx) => {
      const lobbySnap = await tx.get(lobbyRef);
      if (!lobbySnap.exists) return { ok: false, reason: 'lobby_not_found' };

      const lobby = docToLobby(lobbySnap.data() as DocumentData);
      if (lobby.status === 'completed') return { ok: false, reason: 'already_completed' };
      if (lobby.playerList.length === 0) return { ok: false, reason: 'empty_lobby' };

      const winningTeam = Math.random() < 0.5 ? 'Alpha' : 'Bravo';
      const roster = lobby.playerList.slice(0, 12);
      const scoreboard = makeScoreboard(roster, winningTeam);

      // All participant reads must happen before any write in a transaction.
      const playerRefs = roster.map((p) => this.db.collection(C.players).doc(p.playerId));
      const playerSnaps = playerRefs.length > 0 ? await tx.getAll(...playerRefs) : [];

      const match: Match = {
        matchId: crypto.randomUUID(),
        lobbyId,
        gameMode: lobby.gameMode,
        region: lobby.region,
        durationSeconds: 180 + Math.floor(Math.random() * 2000),
        winningTeam,
        scoreboard,
        timestamp: new Date().toISOString(),
      };

      tx.set(this.db.collection(C.matches).doc(match.matchId), matchToDoc(match));
      tx.update(lobbyRef, { status: 'completed', updatedAt: ts(match.timestamp) });

      for (const [i, snap] of playerSnaps.entries()) {
        if (!snap.exists) continue;
        const entry = scoreboard[i];
        if (!entry) continue;
        const won = entry.mmrDelta > 0;
        const player = docToPlayer(snap.data() as DocumentData, snap.id);
        const wins = player.stats.wins + (won ? 1 : 0);
        const losses = player.stats.losses + (won ? 0 : 1);

        tx.update(snap.ref, {
          mmr: Math.max(800, Math.min(3200, player.mmr + entry.mmrDelta)),
          'stats.kills': FieldValue.increment(entry.kills),
          'stats.deaths': FieldValue.increment(entry.deaths),
          'stats.wins': wins,
          'stats.losses': losses,
          'stats.winRate': Math.round((wins / Math.max(1, wins + losses)) * 1000) / 1000,
          lastLoginAt: ts(match.timestamp),
        });
      }

      return { ok: true, match };
    });
  }

  // ---------------------------------------------------------------- matches

  async matchHistory(opts: MatchHistoryOptions): Promise<Page<Match>> {
    let q: Query = this.db.collection(C.matches);
    if (opts.playerId) q = q.where('participantIds', 'array-contains', opts.playerId);
    q = q.orderBy('timestamp', 'desc').orderBy('__name__', 'desc');

    const cursorValues = decodeCursor(opts.cursor);
    if (cursorValues) {
      const [isoTs, id] = cursorValues as [string, string];
      q = q.startAfter(ts(isoTs), id);
    }

    const snap = await q.limit(opts.limit + 1).get();
    const docs = snap.docs.slice(0, opts.limit);
    const hasMore = snap.docs.length > opts.limit;
    const last = docs.at(-1);

    return {
      items: docs.map((d) => docToMatch(d.data())),
      nextCursor: hasMore && last ? encodeCursor([toIso(last.get('timestamp')), last.id]) : null,
      hasMore,
    };
  }

  // ------------------------------------------------------------- aggregates

  async aggregates(): Promise<Aggregates> {
    const t0 = performance.now();
    const players = this.db.collection(C.players);
    const dayAgo = Timestamp.fromMillis(Date.now() - 86_400_000);

    // Kept as two single-field aggregations on purpose: combining average('mmr')
    // with sum('currency.credits') in one call would demand a dedicated
    // composite index for a stat nobody queries any other way.
    const [countsSnap, avgSnap, creditsSnap, topSnap, bottomSnap, onlineSnap, lobbyTotal, lobbyActive, matchTotal] =
      await Promise.all([
        players.count().get(),
        players.aggregate({ avgMmr: AggregateField.average('mmr') }).get(),
        players.aggregate({ sumCredits: AggregateField.sum('currency.credits') }).get(),
        players.orderBy('mmr', 'desc').limit(1).get(),
        players.orderBy('mmr', 'asc').limit(1).get(),
        players.where('lastLoginAt', '>=', dayAgo).count().get(),
        this.db.collection(C.lobbies).count().get(),
        this.db.collection(C.lobbies).where('status', 'in', ['waiting', 'in_progress']).count().get(),
        this.db.collection(C.matches).count().get(),
      ]);

    const byRegion = await Promise.all(
      REGIONS.map(async (region) => {
        const scoped = players.where('region', '==', region);
        const [c, a] = await Promise.all([
          scoped.count().get(),
          scoped.aggregate({ avgMmr: AggregateField.average('mmr') }).get(),
        ]);
        return {
          region,
          players: c.data().count,
          avgMmr: Math.round(a.data().avgMmr ?? 0),
        };
      }),
    );

    const counts: Counts = {
      players: countsSnap.data().count,
      lobbies: lobbyTotal.data().count,
      matches: matchTotal.data().count,
      activeLobbies: lobbyActive.data().count,
      playersOnline: onlineSnap.data().count,
    };

    return {
      counts,
      avgMmr: Math.round(avgSnap.data().avgMmr ?? 0),
      maxMmr: (topSnap.docs[0]?.get('mmr') as number) ?? 0,
      minMmr: (bottomSnap.docs[0]?.get('mmr') as number) ?? 0,
      sumCredits: creditsSnap.data().sumCredits ?? 0,
      byRegion,
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  // -------------------------------------------------------------- purchase

  async purchaseItem(playerId: string, catalogItemId: string): Promise<PurchaseResult> {
    const t0 = performance.now();
    const item = CATALOG_BY_ID.get(catalogItemId);
    if (!item) {
      return { ok: false, reason: 'unknown_item', playerId, latencyMs: Math.round(performance.now() - t0) };
    }

    const playerRef = this.db.collection(C.players).doc(playerId);

    const result = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      if (!snap.exists) return { ok: false as const, reason: 'player_not_found' };

      const player = docToPlayer(snap.data() as DocumentData, snap.id);
      const { credits, plasmaCores } = player.currency;

      if (credits < item.priceCredits) {
        return { ok: false as const, reason: 'insufficient_credits', creditsBefore: credits };
      }
      if (plasmaCores < item.pricePlasmaCores) {
        return { ok: false as const, reason: 'insufficient_plasma_cores', creditsBefore: credits };
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

      tx.update(playerRef, {
        'currency.credits': FieldValue.increment(-item.priceCredits),
        'currency.plasmaCores': FieldValue.increment(-item.pricePlasmaCores),
      });
      tx.set(playerRef.collection(C.inventory).doc(owned.itemId), itemToDoc(owned));

      return {
        ok: true as const,
        item: owned,
        creditsBefore: credits,
        creditsAfter: credits - item.priceCredits,
      };
    });

    return { ...result, playerId, latencyMs: Math.round(performance.now() - t0) };
  }

  // ------------------------------------------------------------ bulk writes

  async bulkInsert(req: BulkInsertRequest): Promise<BulkInsertResult> {
    const t0 = performance.now();
    const writer: BulkWriter = this.db.bulkWriter();
    writer.onWriteError((err) => err.failedAttempts < 5);

    let written = 0;
    const summaries: PlayerSummary[] = [];

    for (let i = 0; i < req.players; i++) {
      const player = makePlayer();
      summaries.push(toSummary(player));
      const ref = this.db.collection(C.players).doc(player.playerId);
      void writer.set(ref, playerToDoc(player));
      written++;

      for (const item of makeInventory(req.inventoryPerPlayer)) {
        void writer.set(ref.collection(C.inventory).doc(item.itemId), itemToDoc(item));
        written++;
      }
    }

    // Lobbies need a candidate roster; fall back to existing players when this
    // batch created none.
    let candidates = summaries;
    if (candidates.length === 0 && (req.lobbies > 0 || req.matches > 0)) {
      const existing = await this.db.collection(C.players).limit(120).get();
      candidates = existing.docs.map((d) => toSummary(docToPlayer(d.data(), d.id)));
    }

    const lobbies: Lobby[] = [];
    for (let i = 0; i < req.lobbies; i++) {
      const lobby = makeLobby(candidates);
      lobbies.push(lobby);
      void writer.set(this.db.collection(C.lobbies).doc(lobby.lobbyId), lobbyToDoc(lobby));
      written++;
    }

    for (let i = 0; i < req.matches; i++) {
      const source = lobbies[i % Math.max(1, lobbies.length)] ?? makeLobby(candidates, 'completed');
      const match = makeMatch(source);
      void writer.set(this.db.collection(C.matches).doc(match.matchId), matchToDoc(match));
      written++;
    }

    await writer.close();

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
    const before = await Promise.all([
      this.db.collection(C.players).count().get(),
      this.db.collection(C.lobbies).count().get(),
      this.db.collection(C.matches).count().get(),
    ]);
    const deleted = before.reduce((sum, s) => sum + s.data().count, 0);

    // recursiveDelete walks sub-collections, so player inventories go too.
    await Promise.all([
      this.db.recursiveDelete(this.db.collection(C.players)),
      this.db.recursiveDelete(this.db.collection(C.lobbies)),
      this.db.recursiveDelete(this.db.collection(C.matches)),
      this.db.recursiveDelete(this.db.collection(C.leaderboards)),
    ]);

    return { deleted };
  }

  // ------------------------------------------------------- workload drivers

  /**
   * Firestore has no "random document" primitive. Seeking to a randomly
   * generated key and taking the next document by name gives an even-enough
   * spread for load generation, and costs one indexed read.
   */
  private async randomPlayerRefs(n: number): Promise<Array<{ id: string; data: DocumentData }>> {
    const picks: Array<{ id: string; data: DocumentData }> = [];

    for (let i = 0; i < n; i++) {
      const probe = `plr_${crypto.randomUUID().slice(0, 12)}`;
      let snap = await this.db.collection(C.players).orderBy('__name__').startAt(probe).limit(1).get();
      if (snap.empty) {
        snap = await this.db.collection(C.players).orderBy('__name__').limit(1).get();
      }
      const doc = snap.docs[0];
      if (doc) picks.push({ id: doc.id, data: doc.data() });
    }

    return picks;
  }

  async readWorkload(count: number): Promise<WorkloadResult> {
    const t0 = performance.now();
    let documents = 0;
    const kinds: string[] = [];

    for (let i = 0; i < count; i++) {
      // Rotate through the three read shapes a game client actually issues, so
      // point reads, range queries and aggregations all show up in metrics.
      switch (i % 3) {
        case 0: {
          const [pick] = await this.randomPlayerRefs(1);
          documents += 1;
          if (pick) {
            const inv = await this.db
              .collection(C.players)
              .doc(pick.id)
              .collection(C.inventory)
              .limit(10)
              .get();
            documents += inv.size;
          }
          kinds.push('point+inventory');
          break;
        }
        case 1: {
          const region = REGIONS[Math.floor(Math.random() * REGIONS.length)] as Region;
          const snap = await this.db
            .collection(C.players)
            .where('region', '==', region)
            .orderBy('mmr', 'desc')
            .limit(25)
            .get();
          documents += snap.size;
          kinds.push(`leaderboard:${region}`);
          break;
        }
        default: {
          const region = REGIONS[Math.floor(Math.random() * REGIONS.length)] as Region;
          const agg = await this.db.collection(C.players).where('region', '==', region).count().get();
          documents += agg.data().count > 0 ? 1 : 0;
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
    const picks = await this.randomPlayerRefs(count);
    if (picks.length === 0) {
      return { documents: 0, latencyMs: Math.round(performance.now() - t0), detail: 'no players to update' };
    }

    const writer = this.db.bulkWriter();
    writer.onWriteError((err) => err.failedAttempts < 5);

    for (const pick of picks) {
      // A plausible post-session write: session timestamp, a little MMR drift
      // and a currency payout.
      const drift = Math.floor(Math.random() * 41) - 20;
      const current = (pick.data['mmr'] as number) ?? 1500;
      void writer.update(this.db.collection(C.players).doc(pick.id), {
        mmr: Math.max(800, Math.min(3200, current + drift)),
        rankTier: mmrToRank(Math.max(800, Math.min(3200, current + drift))),
        'currency.credits': FieldValue.increment(Math.floor(Math.random() * 500)),
        'stats.totalPlaytimeHours': FieldValue.increment(0.1),
        lastLoginAt: Timestamp.now(),
      });
    }

    await writer.close();

    return {
      documents: picks.length,
      latencyMs: Math.round(performance.now() - t0),
      detail: `${picks.length} players updated (mmr drift, credits, session time)`,
    };
  }

  async deleteWorkload(count: number): Promise<WorkloadResult> {
    const t0 = performance.now();

    // Deletes target historical matches and closed lobbies. Player documents
    // are left alone so a long-running mixed workload does not erode the very
    // dataset the reads and updates depend on.
    const matches = await this.db.collection(C.matches).orderBy('timestamp', 'asc').limit(count).get();

    let deleted = 0;
    const writer = this.db.bulkWriter();
    writer.onWriteError((err) => err.failedAttempts < 5);

    for (const doc of matches.docs) {
      void writer.delete(doc.ref);
      deleted++;
    }

    const remaining = count - deleted;
    let lobbiesDeleted = 0;
    if (remaining > 0) {
      const lobbies = await this.db
        .collection(C.lobbies)
        .where('status', '==', 'completed')
        .limit(remaining)
        .get();
      for (const doc of lobbies.docs) {
        void writer.delete(doc.ref);
        lobbiesDeleted++;
      }
    }

    await writer.close();

    const total = deleted + lobbiesDeleted;
    return {
      documents: total,
      latencyMs: Math.round(performance.now() - t0),
      detail:
        total === 0
          ? 'nothing left to delete (no matches or completed lobbies)'
          : `${deleted} matches, ${lobbiesDeleted} completed lobbies deleted`,
    };
  }

  // --------------------------------------------------------------- realtime

  subscribeLobbies(onChange: (lobbies: Lobby[]) => void): () => void {
    return this.db
      .collection(C.lobbies)
      .where('status', 'in', ['waiting', 'in_progress'])
      .orderBy('updatedAt', 'desc')
      .limit(40)
      .onSnapshot(
        (snap) => onChange(snap.docs.map((d) => docToLobby(d.data()))),
        (err) => console.error('[firestore] lobby listener error:', err.message),
      );
  }

  subscribeLeaderboard(limit: number, onChange: (rows: LeaderboardRow[]) => void): () => void {
    return this.db
      .collection(C.players)
      .orderBy('mmr', 'desc')
      .orderBy('stats.winRate', 'desc')
      .limit(limit)
      .onSnapshot(
        (snap) => onChange(snap.docs.map((d, i) => ({ ...docToPlayer(d, d.id), rank: i + 1 }))),
        (err) => console.error('[firestore] leaderboard listener error:', err.message),
      );
  }
}

export const FIRESTORE_COLLECTIONS = C;
