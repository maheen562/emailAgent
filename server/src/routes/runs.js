import { Router } from 'express';

import { HttpError, intParam, route } from '../http.js';

// POST /api/runs      start a run now -> 202 { run }, or 409 if one is already running
// GET  /api/runs      run history, newest first
// GET  /api/runs/:id  one run (poll this to watch progress)
export function runsRouter({ repo, runner }) {
  const router = Router();

  router.post(
    '/',
    route((_req, res) => {
      const started = runner.start('manual');
      if (!started) {
        throw new HttpError(409, `Run ${runner.currentRunId()} is already in progress`);
      }
      res.status(202).location(`/api/runs/${started.id}`).json(repo.getRun(started.id));
    }),
  );

  router.get(
    '/',
    route((req, res) => {
      const limit = intParam(req.query.limit, 'limit', { min: 1, max: 100, fallback: 20 });
      res.json({ runs: repo.listRuns(limit), running: runner.isRunning() });
    }),
  );

  router.get(
    '/:id',
    route((req, res) => {
      const run = repo.getRun(intParam(req.params.id, 'id', { min: 1 }));
      if (!run) throw new HttpError(404, 'Run not found');
      res.json(run);
    }),
  );

  return router;
}
