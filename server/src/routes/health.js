import { Router } from 'express';

// GET /api/health -> platform status plus the Python agent's status.
export function healthRouter({ agent }) {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      const agentHealth = await agent.health();
      res.json({ status: 'ok', agent: { reachable: true, ...agentHealth } });
    } catch (err) {
      // The platform itself is still up, so report "degraded" instead of failing.
      res.json({ status: 'degraded', agent: { reachable: false, error: err.message } });
    }
  });
  return router;
}
