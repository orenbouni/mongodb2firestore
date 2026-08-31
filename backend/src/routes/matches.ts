import { Router } from 'express';
import type { LobbyStatus } from '../domain/types.js';
import {
  completeMatch,
  joinLobby,
  leaveLobby,
  listLobbies,
  matchHistory,
  pickCompletableLobby,
} from '../services/matchService.js';
import { asyncRoute, intParam, strParam, withAdapter } from './context.js';

export const lobbiesRouter = Router();
lobbiesRouter.use(withAdapter);

lobbiesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const status = strParam(req.query['status']) as LobbyStatus | undefined;
    res.json({ source: req.source, lobbies: await listLobbies(req.adapter, status) });
  }),
);

lobbiesRouter.post(
  '/:lobbyId/join',
  asyncRoute(async (req, res) => {
    const playerId = String(req.body?.playerId ?? '');
    const result = await joinLobby(req.adapter, req.params['lobbyId'] as string, playerId);
    res.status(result.ok ? 200 : 409).json({ source: req.source, ...result });
  }),
);

lobbiesRouter.post(
  '/:lobbyId/leave',
  asyncRoute(async (req, res) => {
    const playerId = String(req.body?.playerId ?? '');
    const result = await leaveLobby(req.adapter, req.params['lobbyId'] as string, playerId);
    res.status(result.ok ? 200 : 409).json({ source: req.source, ...result });
  }),
);

lobbiesRouter.post(
  '/:lobbyId/complete',
  asyncRoute(async (req, res) => {
    const result = await completeMatch(req.adapter, req.params['lobbyId'] as string);
    res.status(result.ok ? 200 : 409).json({ source: req.source, ...result });
  }),
);

/** Convenience for the control panel: close whichever lobby is available. */
lobbiesRouter.post(
  '/complete-random',
  asyncRoute(async (req, res) => {
    const lobby = await pickCompletableLobby(req.adapter);
    if (!lobby) {
      res.status(409).json({ ok: false, reason: 'no_completable_lobby' });
      return;
    }
    const result = await completeMatch(req.adapter, lobby.lobbyId);
    res.status(result.ok ? 200 : 409).json({ source: req.source, lobbyId: lobby.lobbyId, ...result });
  }),
);

export const matchesRouter = Router();
matchesRouter.use(withAdapter);

matchesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const page = await matchHistory(req.adapter, {
      limit: intParam(req.query['limit'], 20, 1, 100),
      cursor: strParam(req.query['cursor']),
      playerId: strParam(req.query['playerId']),
    });
    res.json({ source: req.source, ...page });
  }),
);
