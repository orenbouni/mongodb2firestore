export type DataSourceKind = 'firestore' | 'mongo';
export type Region = 'na-east' | 'eu-west' | 'ap-southeast';
export type RankTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';
export type ItemType = 'weapon' | 'armor' | 'skin' | 'consumable';
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';
export type GameMode = 'Ranked 3v3' | 'Battle Royale' | 'Deathmatch';
export type LobbyStatus = 'waiting' | 'in_progress' | 'completed';

export interface PlayerStats {
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPlaytimeHours: number;
}

export interface Player {
  playerId: string;
  username: string;
  region: Region;
  level: number;
  rankTier: RankTier;
  mmr: number;
  stats: PlayerStats;
  currency: { credits: number; plasmaCores: number };
  createdAt: string;
  lastLoginAt: string;
}

export interface LeaderboardRow extends Player {
  rank: number;
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
  latencyMs: number;
}

export interface ConnectionInfo {
  source: DataSourceKind;
  displayName: string;
  connectionString: string;
  host: string;
  addresses: Array<{ label: string; value: string }>;
  database: string;
  details: Array<{ label: string; value: string }>;
  supportsChangeStream: boolean;
  realtimeMechanism: string;
}

export interface SourceStatus {
  kind: DataSourceKind;
  available: boolean;
  error?: string;
  info: ConnectionInfo | null;
  ping: { ok: boolean; latencyMs: number; detail?: string } | null;
}

export interface SourcesResponse {
  defaultSource: DataSourceKind;
  server: {
    host: string;
    platform: string;
    nodeVersion: string;
    addresses: string[];
    apiPort: number;
  };
  sources: SourceStatus[];
}

export interface CatalogItem {
  catalogId: string;
  name: string;
  itemType: ItemType;
  rarity: Rarity;
  powerRating: number;
  priceCredits: number;
  pricePlasmaCores: number;
}

export interface PlayerProfile {
  player: Player;
  inventory: InventoryItem[];
  loadout: { equipped: InventoryItem[]; totalPowerRating: number; legendaryCount: number };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type SimEntity = 'players' | 'lobbies' | 'matches' | 'mixed';

export type WorkloadOp = 'insert' | 'read' | 'update' | 'delete';
export const WORKLOAD_OPS: WorkloadOp[] = ['insert', 'read', 'update', 'delete'];

export type WorkloadMix = Record<WorkloadOp, number>;
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
  inserted: number;
  target: number;
  ticks: number;
  plannedTicks: number;
  perTick: number;
  intervalMs: number;
  elapsedMs: number;
  docsPerSecond: number;
  lastBatchMs: number;
  documentsWritten: number;
  mix: WorkloadMix;
  ops: OpCounts;
  opDocuments: OpCounts;
  recent: ActivityEntry[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface SimulationPlan {
  perTick: number;
  plannedTicks: number;
  intervalMs: number;
  estimatedDurationMs: number;
  estimatedDocuments: number;
  opTotals: OpCounts;
}

export interface WorkloadResult {
  op: WorkloadOp;
  count: number;
  documents: number;
  latencyMs: number;
  detail: string;
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
