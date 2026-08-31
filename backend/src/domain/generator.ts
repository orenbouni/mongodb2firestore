import { randomUUID } from 'node:crypto';
import {
  GAME_MODES,
  ITEM_TYPES,
  RARITIES,
  REGIONS,
  type GameMode,
  type InventoryItem,
  type ItemType,
  type Lobby,
  type LobbyStatus,
  type Match,
  type Player,
  type PlayerSummary,
  type RankTier,
  type Rarity,
  type Region,
  type ScoreboardEntry,
} from './types.js';

const PREFIXES = [
  'Valkyrie', 'Nova', 'Shadow', 'Iron', 'Void', 'Neon', 'Quantum', 'Crimson', 'Frost', 'Solar',
  'Ghost', 'Cobalt', 'Ember', 'Zenith', 'Rogue', 'Astral', 'Titan', 'Hex', 'Pulse', 'Onyx',
  'Vortex', 'Cinder', 'Halcyon', 'Rift', 'Umbra', 'Sable', 'Blitz', 'Krypt', 'Lumen', 'Draco',
];
const SUFFIXES = [
  'Striker', 'Blade', 'Wraith', 'Hunter', 'Warden', 'Reaper', 'Fang', 'Sentinel', 'Prowler', 'Havoc',
  'Specter', 'Raider', 'Talon', 'Vanguard', 'Nomad', 'Breaker', 'Sniper', 'Phantom', 'Ronin', 'Saber',
];

const WEAPON_NAMES = [
  'Plasma Rifle', 'Ion Scattergun', 'Singularity Lance', 'Void Reaper', 'Arc Repeater',
  'Graviton Cannon', 'Photon Carbine', 'Railgun Prototype', 'Pulse SMG', 'Nova Launcher',
];
const ARMOR_NAMES = [
  'Carbon Weave Vest', 'Aegis Barrier MK-III', 'Titanfall Exosuit', 'Kinetic Deflector',
  'Nanoplate Harness', 'Bulwark Shell', 'Phase Shroud', 'Reactive Plating',
];
const SKIN_NAMES = [
  'Cyber Samurai', 'Nebula Drifter', 'Crimson Vanguard', 'Obsidian Legion', 'Solar Flare',
  'Deep Freeze', 'Chrome Dynasty', 'Ghost Protocol', 'Bloom of Ash',
];
const CONSUMABLE_NAMES = [
  'Nano Medkit', 'Overdrive Stim', 'Shield Cell', 'Phase Grenade', 'Repair Drone', 'Adrenal Booster',
];

const NAMES_BY_TYPE: Record<ItemType, string[]> = {
  weapon: WEAPON_NAMES,
  armor: ARMOR_NAMES,
  skin: SKIN_NAMES,
  consumable: CONSUMABLE_NAMES,
};

const TEAMS = ['Alpha', 'Bravo'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Box-Muller, clamped — gives a believable bell curve for MMR rather than a flat spread. */
function gaussian(mean: number, stdDev: number, min: number, max: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.min(max, Math.max(min, Math.round(mean + n * stdDev)));
}

export function mmrToRank(mmr: number): RankTier {
  if (mmr < 1100) return 'Bronze';
  if (mmr < 1500) return 'Silver';
  if (mmr < 1900) return 'Gold';
  if (mmr < 2300) return 'Platinum';
  if (mmr < 2750) return 'Diamond';
  return 'Master';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function makeUsername(): string {
  const style = Math.random();
  const base = `${pick(PREFIXES)}${pick(SUFFIXES)}`;
  if (style < 0.35) return `${base}_${randInt(1, 99)}`;
  if (style < 0.6) return `x${base}x`;
  if (style < 0.8) return `${pick(PREFIXES)}_${pick(SUFFIXES)}${randInt(0, 999)}`;
  return `${base}${randInt(1, 9999)}`;
}

function isoAgo(maxDaysAgo: number, minDaysAgo = 0): string {
  const days = Math.random() * (maxDaysAgo - minDaysAgo) + minDaysAgo;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function makePlayer(): Player {
  const mmr = gaussian(1800, 480, 800, 3200);
  const rankTier = mmrToRank(mmr);
  // Level correlates loosely with MMR so the data reads as plausible progression.
  const level = Math.min(100, Math.max(1, Math.round((mmr - 800) / 24) + randInt(-8, 8)));
  const wins = randInt(0, 900);
  const losses = randInt(0, 900);
  const total = wins + losses;
  const kills = randInt(0, 20) * Math.max(1, Math.round(total / 4));
  const deaths = randInt(0, 18) * Math.max(1, Math.round(total / 4));
  const createdAt = isoAgo(900, 5);

  return {
    playerId: `plr_${randomUUID().slice(0, 12)}`,
    username: makeUsername(),
    region: pick(REGIONS),
    level,
    rankTier,
    mmr,
    stats: {
      kills,
      deaths,
      wins,
      losses,
      winRate: total === 0 ? 0 : Math.round((wins / total) * 1000) / 1000,
      totalPlaytimeHours: Math.round((total * randInt(8, 22)) / 60 * 10) / 10,
    },
    currency: {
      credits: randInt(250, 95_000),
      plasmaCores: randInt(0, 320),
    },
    createdAt,
    lastLoginAt: isoAgo(14),
  };
}

export function makeInventoryItem(): InventoryItem {
  const itemType = pick(ITEM_TYPES);
  const name = pick(NAMES_BY_TYPE[itemType]);
  // Rarity is weighted — Legendary drops should feel rare in the UI.
  const roll = Math.random();
  const rarity: Rarity = roll < 0.55 ? 'Common' : roll < 0.83 ? 'Rare' : roll < 0.96 ? 'Epic' : 'Legendary';
  const rarityFloor: Record<Rarity, [number, number]> = {
    Common: [50, 220],
    Rare: [200, 480],
    Epic: [450, 720],
    Legendary: [700, 950],
  };
  const [lo, hi] = rarityFloor[rarity];
  const prefix = itemType === 'weapon' ? 'wpn' : itemType === 'armor' ? 'arm' : itemType === 'skin' ? 'skin' : 'con';

  return {
    itemId: `${prefix}_${slug(name)}_${randomUUID().slice(0, 6)}`,
    name,
    itemType,
    rarity,
    powerRating: randInt(lo, hi),
    isEquipped: false,
    acquiredAt: isoAgo(700),
  };
}

/** Builds one inventory per player, equipping at most one item of each type. */
export function makeInventory(count: number): InventoryItem[] {
  const items = Array.from({ length: count }, () => makeInventoryItem());
  const equipped = new Set<ItemType>();
  for (const item of items) {
    if (!equipped.has(item.itemType) && Math.random() < 0.6) {
      item.isEquipped = true;
      equipped.add(item.itemType);
    }
  }
  return items;
}

export function maxPlayersFor(mode: GameMode): number {
  return mode === 'Battle Royale' ? 60 : 6;
}

export function makeLobby(candidates: PlayerSummary[], forcedStatus?: LobbyStatus): Lobby {
  const gameMode = pick(GAME_MODES);
  const maxPlayers = maxPlayersFor(gameMode);
  const status: LobbyStatus = forcedStatus ?? pick(['waiting', 'waiting', 'in_progress', 'completed'] as LobbyStatus[]);
  // Waiting lobbies are partially full so the UI shows slots filling up live.
  const fill = status === 'waiting' ? randInt(1, Math.max(1, maxPlayers - 1)) : maxPlayers;
  const playerList = shuffle(candidates).slice(0, Math.min(fill, candidates.length));
  const createdAt = isoAgo(2);

  return {
    lobbyId: randomUUID(),
    gameMode,
    status,
    maxPlayers,
    region: pick(REGIONS),
    playerList,
    createdAt,
    updatedAt: new Date(Math.max(Date.parse(createdAt), Date.now() - randInt(0, 3600) * 1000)).toISOString(),
  };
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function makeScoreboard(players: PlayerSummary[], winningTeam: string): ScoreboardEntry[] {
  return players.map((p, idx) => {
    const team = TEAMS[idx % TEAMS.length] as string;
    const won = team === winningTeam;
    return {
      playerId: p.playerId,
      username: p.username,
      team,
      kills: randInt(won ? 4 : 0, won ? 32 : 18),
      deaths: randInt(won ? 0 : 3, won ? 12 : 24),
      assists: randInt(0, 20),
      damageDealt: randInt(1200, 48_000),
      mmrDelta: won ? randInt(12, 34) : -randInt(10, 30),
    };
  });
}

export function makeMatch(lobby: Lobby): Match {
  const winningTeam = pick(TEAMS);
  return {
    matchId: randomUUID(),
    lobbyId: lobby.lobbyId,
    gameMode: lobby.gameMode,
    region: lobby.region,
    durationSeconds: randInt(180, 2400),
    winningTeam,
    scoreboard: makeScoreboard(lobby.playerList.slice(0, 12), winningTeam),
    timestamp: isoAgo(60),
  };
}

export function toSummary(p: Player): PlayerSummary {
  return { playerId: p.playerId, username: p.username, rankTier: p.rankTier };
}
