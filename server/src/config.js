// Settings for the Node platform, read from environment variables / server/.env.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    agentUrl: (env.AGENT_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    agentTimeoutMs: Number(env.AGENT_TIMEOUT_MS ?? 120_000),
  };
}
