import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { closeAll } from './adapters/registry.js';
import { env } from './config/env.js';
import { closeMongo } from './config/mongo.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { lobbiesRouter, matchesRouter } from './routes/matches.js';
import { playersRouter } from './routes/players.js';
import { adminRouter, simulationRouter } from './routes/simulation.js';
import { streamRouter } from './routes/stream.js';
import { systemRouter } from './routes/system.js';
import { simulation } from './services/simulationService.js';

const app = express();

app.use(cors({ exposedHeaders: ['x-data-source'] }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/system', systemRouter);
app.use('/api/players', playersRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/lobbies', lobbiesRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/admin', adminRouter);
app.use('/api/stream', streamRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api] unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal_error', message: err.message });
});

const server = app.listen(env.port, () => {
  console.log(`[aegis] API listening on http://localhost:${env.port}`);
  console.log(`[aegis] default source: ${env.defaultSource}`);
  console.log(`[aegis] firestore: ${env.gcpProjectId || '(adc project)'} / ${env.firestoreDatabaseId}`);
  console.log(`[aegis] mongodb:   ${env.mongoUri} db=${env.mongoDb}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[aegis] ${signal} received, shutting down`);
  simulation.stopAll();
  server.close();
  await closeAll();
  await closeMongo();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
