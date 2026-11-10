import { Router } from 'express';

import { intParam, route } from '../http.js';

// GET /api/emails?limit=&offset=  -> the "inbox view": one row per alert email
// with its one-line summary and verdict counts.
export function emailsRouter({ repo }) {
  const router = Router();
  router.get(
    '/',
    route((req, res) => {
      res.json(
        repo.listEmails({
          limit: intParam(req.query.limit, 'limit', { min: 1, max: 200, fallback: 50 }),
          offset: intParam(req.query.offset, 'offset', { fallback: 0 }),
        }),
      );
    }),
  );
  return router;
}
