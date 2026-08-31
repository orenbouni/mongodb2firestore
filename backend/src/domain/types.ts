export type Region = 'na-east' | 'eu-west' | 'ap-southeast';
export const REGIONS: Region[] = ['na-east', 'eu-west', 'ap-southeast'];

export type RankTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';
export const RANK_TIERS: RankTier[] = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master'];

export type ItemType = 'weapon' | 'armor' | 'skin' | 'consumable';
export const ITEM_TYPES: ItemType[] = ['weapon', 'armor', 'skin', 'consumable'];

export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';
export const RARITIES: Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary'];

export type GameMode = 'Ranked 3v3' | 'Battle Royale' | 'Deathmatch';
export const GAME_MODES: GameMode[] = ['Ranked 3v3', 'Battle Royale', 'Deathmatch'];

export type LobbyStatus = 'waiting' | 'in_progress' | 'completed';

export interface PlayerStats {
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPlaytimeHours: number;
}

export interface Currency {
  credits: number;
  plasmaCores: number;
}

export interface Player {
  playerId: string;
  username: string;
  region: Region;
  level: number;
  rankTier: RankTier;
  mmr: number;
  stats: PlayerStats;
  currency: Currency;
  createdAt: string;
  lastLoginAt: string;
}

export interface InventoryItem {
  itemId: string;
  name: string;
  itemType: ItemType;
  rarity: Rarity;
  powerRating: number;
  isEquipped: boolean;
  acquiredAt: string;
}

export interface PlayerSummary {
  playerId: string;
  username: string;
  rankTier: RankTier;
}

export interface Lobby {
  lobbyId: string;
  gameMode: GameMode;
  status: LobbyStatus;
  maxPlayers: number;
  region: Region;
  playerList: PlayerSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ScoreboardEntry {
  playerId: string;
  username: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  mmrDelta: number;
}

export interface Match {
  matchId: string;
  lobbyId: string;
  gameMode: GameMode;
  region: Region;
  durationSeconds: number;
  winningTeam: string;
  scoreboard: ScoreboardEntry[];
  timestamp: string;
}

/** A page of results plus the opaque cursor needed to fetch the next one. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Counts {
  players: number;
  lobbies: number;
  matches: number;
  activeLobbies: number;
  playersOnline: number;
}

export interface Aggregates {
  counts: Counts;
  avgMmr: number;
  maxMmr: number;
  minMmr: number;
  sumCredits: number;
  byRegion: Array<{ region: string; players: number; avgMmr: number }>;
  /** Milliseconds the aggregation round-trip took — surfaced in the UI. */
  latencyMs: number;
}

export interface LeaderboardRow extends Player {
  rank: number;
}

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  playerId: string;
  item?: InventoryItem;
  creditsBefore?: number;
  creditsAfter?: number;
  latencyMs: number;
}

export interface ConnectionInfo {
  source: DataSourceKind;
  displayName: string;
  /** Human-readable connection string with any secrets redacted. */
  connectionString: string;
  host: string;
  /** Resolved network addresses, when known. */
  addresses: Array<{ label: string; value: string }>;
  database: string;
  details: Array<{ label: string; value: string }>;
  /** True when this adapter can push real change events rather than polling. */
  supportsChangeStream: boolean;
  realtimeMechanism: string;
}

export type DataSourceKind = 'firestore' | 'mongo';

export interface ListPlayersOptions {
  limit: number;
  cursor?: string | undefined;
  region?: Region | undefined;
  rankTier?: RankTier | undefined;
  search?: string | undefined;
}

export interface LeaderboardOptions {
  limit: number;
  region?: Region | undefined;
  rankTier?: RankTier | undefined;
}

export interface MatchHistoryOptions {
  limit: number;
  cursor?: string | undefined;
  playerId?: string | undefined;
}

export interface BulkInsertRequest {
  players: number;
  inventoryPerPlayer: number;
  lobbies: number;
  matches: number;
}

export interface BulkInsertResult {
  written: number;
  breakdown: Record<string, number>;
  latencyMs: number;
  docsPerSecond: number;
}

export type WorkloadOp = 'insert' | 'read' | 'update' | 'delete';
export const WORKLOAD_OPS: WorkloadOp[] = ['insert', 'read', 'update', 'delete'];

/** Relative weights; the engine normalises them into a per-tick op schedule. */
export type WorkloadMix = Record<WorkloadOp, number>;

export interface WorkloadResult {
  /** Documents actually touched by the server, for console/metrics parity. */
  documents: number;
  latencyMs: number;
  /** Short human-readable note about what ran, surfaced in the activity log. */
  detail: string;
}

/**
 * The contract both Firestore and MongoDB implement. Every route in the API
 * talks only to this interface, which is what makes the UI's source switch a
 * one-line swap rather than a second code path.
 */
export interface DataAdapter {
  readonly kind: DataSourceKind;
  init(): Promise<void>;
  close(): Promise<void>;
  connectionInfo(): ConnectionInfo;
  ping(): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;

  listPlayers(opts: ListPlayersOptions): Promise<Page<Player>>;
  getPlayer(playerId: string): Promise<Player | null>;
  getInventory(playerId: string): Promise<InventoryItem[]>;
  equipItem(playerId: string, itemId: string, equip: boolean): Promise<InventoryItem | null>;

  leaderboard(opts: LeaderboardOptions): Promise<LeaderboardRow[]>;

  listLobbies(status?: LobbyStatus): Promise<Lobby[]>;
  getLobby(lobbyId: string): Promise<Lobby | null>;
  joinLobby(lobbyId: string, playerId: string): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }>;
  leaveLobby(lobbyId: string, playerId: string): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }>;
  completeMatch(lobbyId: string): Promise<{ ok: boolean; reason?: string; match?: Match }>;

  matchHistory(opts: MatchHistoryOptions): Promise<Page<Match>>;

  aggregates(): Promise<Aggregates>;

  purchaseItem(playerId: string, catalogItemId: string): Promise<PurchaseResult>;

  bulkInsert(req: BulkInsertRequest): Promise<BulkInsertResult>;
  clearAll(): Promise<{ deleted: number }>;

  /**
   * Deliberate load generators. Insert-only traffic makes a database look busy
   * in write metrics but leaves reads, updates and deletes flat, so the
   * simulation drives all four and each is a distinct method.
   */
  readWorkload(count: number): Promise<WorkloadResult>;
  updateWorkload(count: number): Promise<WorkloadResult>;
  deleteWorkload(count: number): Promise<WorkloadResult>;

  /** Push-based where supported, polled otherwise. Returns an unsubscribe fn. */
  subscribeLobbies(onChange: (lobbies: Lobby[]) => void): () => void;
  subscribeLeaderboard(limit: number, onChange: (rows: LeaderboardRow[]) => void): () => void;
}
