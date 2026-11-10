import { Router } from 'express';

import { HttpError, route } from '../http.js';

// GET /api/profile  -> current profile
// PUT /api/profile  -> validate with the Python agent (the single source of truth
//                      for the profile's shape), then save the normalised version
export function profileRouter({ profileStore, agent }) {
  const router = Router();

  router.get('/', (_req, res) => res.json(profileStore.get()));

  router.put(
    '/',
    route(async (req, res) => {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new HttpError(400, 'Profile must be a JSON object');
      }
      let profile;
      try {
        profile = await agent.validateProfile(req.body);
      } catch (err) {
        if (err.status === 422) throw new HttpError(422, `Invalid profile: ${err.message}`);
        throw new HttpError(502, `Could not validate profile: ${err.message}`);
      }
      profileStore.save(profile);
      res.json(profile);
    }),
  );

  return router;
}
