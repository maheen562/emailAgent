import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { healthRouter } from './routes/health.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Builds the Express app. Dependencies are passed in so tests can use fakes.
export function createApp({ agent }) {
  const app = express();
  app.use(express.json());

  app.use('/api/health', healthRouter({ agent }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(publicDir));

  // Central error handler: log the details, return a safe JSON message.
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.expose ? err.message : 'Internal server error' });
  });

  return app;
}
