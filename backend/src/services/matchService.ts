import type { DataAdapter, Lobby, LobbyStatus, Match, MatchHistoryOptions, Page } from '../domain/types.js';

export async function listLobbies(adapter: DataAdapter, status?: LobbyStatus): Promise<Lobby[]> {
  return adapter.listLobbies(status);
}

export async function joinLobby(
  adapter: DataAdapter,
  lobbyId: string,
  playerId: string,
): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }> {
  return adapter.joinLobby(lobbyId, playerId);
}

export async function leaveLobby(
  adapter: DataAdapter,
  lobbyId: string,
  playerId: string,
): Promise<{ ok: boolean; reason?: string; lobby?: Lobby }> {
  return adapter.leaveLobby(lobbyId, playerId);
}

export async function completeMatch(
  adapter: DataAdapter,
  lobbyId: string,
): Promise<{ ok: boolean; reason?: string; match?: Match }> {
  return adapter.completeMatch(lobbyId);
}

export async function matchHistory(adapter: DataAdapter, opts: MatchHistoryOptions): Promise<Page<Match>> {
  return adapter.matchHistory(opts);
}

/** Picks a lobby that is safe to auto-complete, for the simulation panel. */
export async function pickCompletableLobby(adapter: DataAdapter): Promise<Lobby | null> {
  const lobbies = await adapter.listLobbies();
  const candidates = lobbies.filter((l) => l.status !== 'completed' && l.playerList.length > 0);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}
