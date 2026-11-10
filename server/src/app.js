import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { emailsRouter } from './routes/emails.js';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';
import { profileRouter } from './routes/profile.js';
import { runsRouter } from './routes/runs.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Builds the Express app. Dependencies are passed in so tests can use fakes.
export function createApp({ agent, repo, runner, profileStore }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter({ agent }));
  if (repo) {
    app.use('/api/jobs', jobsRouter({ repo }));
    app.use('/api/emails', emailsRouter({ repo }));
    app.use('/api/runs', runsRouter({ repo, runner }));
    app.use('/api/profile', profileRouter({ profileStore, agent }));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(publicDir));

  // Central error handler: log unexpected errors, return a safe JSON message.
  app.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.expose ? err.message : 'Internal server error' });
  });

  return app;
}
