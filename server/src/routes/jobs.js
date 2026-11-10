import { Router } from 'express';

import { HttpError, intParam, oneOf, route } from '../http.js';
import { JOB_STATUSES, VERDICTS } from '../repo.js';

// GET   /api/jobs?verdict=&status=&minScore=&q=&country=&worldwide=1&sort=score|newest&limit=&offset=
// GET   /api/jobs/:id
// PATCH /api/jobs/:id  { "status": "applied" }
export function jobsRouter({ repo }) {
  const router = Router();

  router.get(
    '/',
    route((req, res) => {
      const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '') || undefined;
      res.json(
        repo.listJobs({
          verdict: oneOf(req.query.verdict, 'verdict', VERDICTS),
          status: oneOf(req.query.status, 'status', JOB_STATUSES),
          minScore: intParam(req.query.minScore, 'minScore', { max: 100 }),
          q: text(req.query.q, 100),
          country: text(req.query.country, 60),
          withWorldwide: oneOf(req.query.worldwide, 'worldwide', ['0', '1']) === '1',
          sort: oneOf(req.query.sort, 'sort', ['score', 'newest']) ?? 'score',
          limit: intParam(req.query.limit, 'limit', { min: 1, max: 200, fallback: 50 }),
          offset: intParam(req.query.offset, 'offset', { fallback: 0 }),
        }),
      );
    }),
  );

  router.get(
    '/:id',
    route((req, res) => {
      const job = repo.getJob(intParam(req.params.id, 'id', { min: 1 }));
      if (!job) throw new HttpError(404, 'Job not found');
      res.json(job);
    }),
  );

  router.patch(
    '/:id',
    route((req, res) => {
      const id = intParam(req.params.id, 'id', { min: 1 });
      const status = oneOf(req.body?.status, 'status', JOB_STATUSES);
      if (!status) throw new HttpError(400, `status is required (one of: ${JOB_STATUSES.join(', ')})`);
      const job = repo.setJobStatus(id, status);
      if (!job) throw new HttpError(404, 'Job not found');
      res.json(job);
    }),
  );

  return router;
}
