import type { DataSourceKind, Lobby } from '../types';
import { Card, Empty, Meter, RankBadge, timeAgo } from './primitives';

const STATUS_STYLE: Record<Lobby['status'], string> = {
  waiting: 'text-warning',
  in_progress: 'text-good',
  completed: 'text-ink-muted',
};

const STATUS_LABEL: Record<Lobby['status'], string> = {
  waiting: 'Waiting',
  in_progress: 'In progress',
  completed: 'Completed',
};

export function LobbyBrowser({
  lobbies,
  source,
  onComplete,
  onJoin,
  busyLobbyId,
}: {
  lobbies: Lobby[];
  source: DataSourceKind;
  onComplete: (lobbyId: string) => void;
  onJoin: (lobbyId: string) => void;
  busyLobbyId: string | null;
}): JSX.Element {
  return (
    <Card
      title="Live matchmaking"
      subtitle={
        <>
          {lobbies.length} active {lobbies.length === 1 ? 'lobby' : 'lobbies'} · streamed from{' '}
          <span className={source === 'firestore' ? 'text-firestore' : 'text-mongo'}>{source}</span>
        </>
      }
      className="h-full"
    >
      {lobbies.length === 0 ? (
        <Empty>No active lobbies. Seed data or start an auto-insert run.</Empty>
      ) : (
        <div className="max-h-[26rem] space-y-2 overflow-y-auto px-3 py-3">
          {lobbies.map((lobby) => (
            <LobbyCard
              key={lobby.lobbyId}
              lobby={lobby}
              onComplete={onComplete}
              onJoin={onJoin}
              busy={busyLobbyId === lobby.lobbyId}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function LobbyCard({
  lobby,
  onComplete,
  onJoin,
  busy,
}: {
  lobby: Lobby;
  onComplete: (lobbyId: string) => void;
  onJoin: (lobbyId: string) => void;
  busy: boolean;
}): JSX.Element {
  const filled = lobby.playerList.length;
  const full = filled >= lobby.maxPlayers;

  return (
    <article className="rounded-md border border-hairline bg-surfaceRaised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink-primary">{lobby.gameMode}</h3>
            <span className={`text-[11px] font-medium ${STATUS_STYLE[lobby.status]}`}>
              {STATUS_LABEL[lobby.status]}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            {lobby.region} · updated {timeAgo(lobby.updatedAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            className="btn px-2 py-1 text-xs"
            disabled={busy || full || lobby.status !== 'waiting'}
            onClick={() => onJoin(lobby.lobbyId)}
            title={full ? 'Lobby is full' : 'Add a random player to this lobby'}
          >
            Join
          </button>
          <button
            className="btn px-2 py-1 text-xs"
            disabled={busy || lobby.status === 'completed'}
            onClick={() => onComplete(lobby.lobbyId)}
            title="Close the lobby and write a match record"
          >
            Complete
          </button>
        </div>
      </div>

      <div className="mt-2.5">
        <div className="mb-1 flex items-baseline justify-between text-[11px]">
          <span className="text-ink-muted">Player slots</span>
          <span className="tabular text-ink-secondary">
            {filled} / {lobby.maxPlayers}
          </span>
        </div>
        <Meter value={filled} max={lobby.maxPlayers} label="lobby fill" tone={full ? 'good' : 'seq'} />
      </div>

      {lobby.playerList.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {lobby.playerList.slice(0, 8).map((p) => (
            <span
              key={p.playerId}
              className="inline-flex items-center gap-1.5 rounded border border-hairline bg-plane px-1.5 py-0.5"
            >
              <RankBadge tier={p.rankTier} />
              <span className="max-w-[9rem] truncate text-[11px] text-ink-secondary">{p.username}</span>
            </span>
          ))}
          {lobby.playerList.length > 8 && (
            <span className="self-center text-[11px] text-ink-muted">
              +{lobby.playerList.length - 8} more
            </span>
          )}
        </div>
      )}
    </article>
  );
}
