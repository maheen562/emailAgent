// Settings for the Node platform, read from environment variables / server/.env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

export function loadConfig(env = process.env) {
  return {
    port: num(env.PORT, 3000),
    agentUrl: (env.AGENT_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    agentTimeoutMs: num(env.AGENT_TIMEOUT_MS, 120_000),
    dbFile: env.DB_FILE ?? path.join(SERVER_DIR, 'data', 'jobs.db'),
    // Each run looks back this many days and skips emails it has already judged.
    lookbackDays: num(env.LOOKBACK_DAYS, 7),
    fetchLimit: num(env.FETCH_LIMIT, 25),
    // Pause between LLM calls so the Gemini free tier's per-minute limit isn't hit.
    summarizeDelayMs: num(env.SUMMARIZE_DELAY_MS, 2_000),
    // A failing email is retried on later runs, at most this many times in total.
    maxEmailAttempts: num(env.MAX_EMAIL_ATTEMPTS, 3),
  };
}
