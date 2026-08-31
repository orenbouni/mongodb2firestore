import { useEffect, useRef, useState } from 'react';
import { streamUrl } from '../services/api';
import type {
  Aggregates,
  ConnectionInfo,
  DataSourceKind,
  LeaderboardRow,
  Lobby,
  SimulationProgress,
} from '../types';

export interface ThroughputSample {
  t: number;
  docsPerSecond: number;
}

export interface LiveState {
  connected: boolean;
  connection: ConnectionInfo | null;
  lobbies: Lobby[];
  leaderboard: LeaderboardRow[];
  aggregates: Aggregates | null;
  jobs: Record<string, SimulationProgress>;
  throughput: ThroughputSample[];
  error: string | null;
  /** Bumps on every server push, so panels can show real liveness. */
  eventCount: number;
}

const EMPTY: LiveState = {
  connected: false,
  connection: null,
  lobbies: [],
  leaderboard: [],
  aggregates: null,
  jobs: {},
  throughput: [],
  error: null,
  eventCount: 0,
};

const THROUGHPUT_WINDOW = 60;

/**
 * Single SSE connection per selected source. Switching source tears the old
 * stream down and opens a new one, so stale events can never bleed across.
 */
export function useLiveStream(source: DataSourceKind, leaderboardLimit = 50): LiveState {
  const [state, setState] = useState<LiveState>(EMPTY);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    setState(EMPTY);
    const es = new EventSource(streamUrl(source, leaderboardLimit));

    const bump = (patch: Partial<LiveState>): void =>
      setState((prev) => ({ ...prev, ...patch, eventCount: prev.eventCount + 1, connected: true }));

    es.addEventListener('connection', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { info: ConnectionInfo };
      bump({ connection: data.info, error: null });
    });

    es.addEventListener('lobbies', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { lobbies: Lobby[] };
      bump({ lobbies: data.lobbies });
    });

    es.addEventListener('leaderboard', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { rows: LeaderboardRow[] };
      bump({ leaderboard: data.rows });
    });

    es.addEventListener('aggregates', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as Aggregates;
      bump({ aggregates: data });
    });

    es.addEventListener('simulation', (e) => {
      const job = JSON.parse((e as MessageEvent<string>).data) as SimulationProgress;
      setState((prev) => {
        const throughput =
          job.status === 'running'
            ? [...prev.throughput, { t: Date.now(), docsPerSecond: job.docsPerSecond }].slice(
                -THROUGHPUT_WINDOW,
              )
            : prev.throughput;
        return {
          ...prev,
          connected: true,
          eventCount: prev.eventCount + 1,
          jobs: { ...prev.jobs, [job.jobId]: job },
          throughput,
        };
      });
    });

    es.addEventListener('error', (e) => {
      // A named 'error' event carries a server payload; the bare one is transport.
      const raw = (e as MessageEvent<string>).data;
      if (typeof raw === 'string' && raw.length > 0) {
        const data = JSON.parse(raw) as { message: string };
        setState((prev) => ({ ...prev, error: data.message }));
      }
    });

    es.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    return () => es.close();
  }, [source, leaderboardLimit]);

  return state;
}
