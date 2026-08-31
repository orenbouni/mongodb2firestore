import { Router } from 'express';
import type { RankTier, Region } from '../domain/types.js';
import { getLeaderboard } from '../services/leaderboardService.js';
import { asyncRoute, intParam, strParam, withAdapter } from './context.js';

export const leaderboardRouter = Router();
leaderboardRouter.use(withAdapter);

leaderboardRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const result = await getLeaderboard(req.adapter, {
      limit: intParam(req.query['limit'], 50, 1, 200),
      region: strParam(req.query['region']) as Region | undefined,
      rankTier: strParam(req.query['rankTier']) as RankTier | undefined,
    });
    res.json({ source: req.source, ...result });
  }),
);
