import { Router } from 'express';

// GET /api/stats -> headline numbers for the dashboard
export function statsRouter({ repo, runner }) {
  const router = Router();
  router.get('/', (_req, res) => res.json({ ...repo.stats(), running: runner.isRunning() }));
  return router;
}
