import { Router } from 'express';
import { CATALOG } from '../domain/catalog.js';
import type { RankTier, Region } from '../domain/types.js';
import { equipItem, getProfile, listPlayers, purchase } from '../services/playerService.js';
import { asyncRoute, intParam, strParam, withAdapter } from './context.js';

export const playersRouter = Router();
playersRouter.use(withAdapter);

playersRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const page = await listPlayers(req.adapter, {
      limit: intParam(req.query['limit'], 25, 1, 200),
      cursor: strParam(req.query['cursor']),
      region: strParam(req.query['region']) as Region | undefined,
      rankTier: strParam(req.query['rankTier']) as RankTier | undefined,
      search: strParam(req.query['search']),
    });
    res.json({ source: req.source, ...page });
  }),
);

playersRouter.get(
  '/catalog',
  asyncRoute(async (_req, res) => {
    res.json({ items: CATALOG });
  }),
);

playersRouter.get(
  '/:playerId',
  asyncRoute(async (req, res) => {
    const profile = await getProfile(req.adapter, req.params['playerId'] as string);
    if (!profile) {
      res.status(404).json({ error: 'player_not_found' });
      return;
    }
    res.json({ source: req.source, ...profile });
  }),
);

playersRouter.post(
  '/:playerId/inventory/:itemId/equip',
  asyncRoute(async (req, res) => {
    const equip = req.body?.equip !== false;
    const item = await equipItem(req.adapter, req.params['playerId'] as string, req.params['itemId'] as string, equip);
    if (!item) {
      res.status(404).json({ error: 'item_not_found' });
      return;
    }
    res.json({ source: req.source, item });
  }),
);

playersRouter.post(
  '/:playerId/purchase',
  asyncRoute(async (req, res) => {
    const catalogItemId = String(req.body?.catalogItemId ?? '');
    const result = await purchase(req.adapter, req.params['playerId'] as string, catalogItemId);
    res.status(result.ok ? 200 : 409).json({ source: req.source, ...result });
  }),
);
