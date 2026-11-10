import { AgentError } from '../src/agentClient.js';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createRunner } from '../src/pipeline.js';
import { createProfileStore } from '../src/profile.js';
import { createRepo } from '../src/repo.js';

export const TEST_CONFIG = {
  lookbackDays: 7,
  fetchLimit: 25,
  summarizeDelayMs: 0,
  maxEmailAttempts: 3,
};

export function makeEmail(n, overrides = {}) {
  return {
    message_id: `<m${n}@example.com>`,
    source: 'linkedin',
    sender: 'jobalerts-noreply@linkedin.com',
    subject: `Alert ${n}`,
    received_at: `2026-11-0${n}T08:00:00+05:00`,
    text: `jobs ${n}`,
    links: [],
    truncated: false,
    ...overrides,
  };
}

export function makeJob(overrides = {}) {
  const factor = { score: 8, reason: 'ok' };
  return {
    title: 'Python Intern',
    company: 'Nimbus Labs',
    location: 'Islamabad',
    work_mode: 'remote',
    employment_type: 'internship',
    experience_required: '0-1 years',
    salary: 'PKR 60,000',
    hours: '40/week',
    summary: 'Build automations.',
    apply_ref: 'L1',
    apply_url: 'https://jobs.example.com/1',
    deadline: null,
    factor_scores: Object.fromEntries(
      ['experience', 'skills', 'work_arrangement', 'terms_pay', 'career_value', 'eligibility'].map((f) => [f, factor]),
    ),
    skills_matched: ['Python'],
    skills_missing: [],
    dealbreakers_hit: [],
    red_flags: [],
    why_it_matters: 'Strong match.',
    overall_score: 80,
    verdict: 'apply_now',
    ...overrides,
  };
}

export function makeSummary(email, jobs) {
  const counts = { apply_now: 0, worth_a_look: 0, skip: 0 };
  for (const job of jobs) counts[job.verdict] += 1;
  return {
    message_id: email.message_id,
    source: email.source,
    job_count: jobs.length,
    counts,
    one_line_summary: `${jobs.length} jobs`,
    jobs,
    usage: { model: 'fake', input_tokens: 100, output_tokens: 50 },
  };
}

export const agentError = (status, message = `error ${status}`) => new AgentError(message, { status });

// A fake Python agent. `summarize` can be a map of message_id -> jobs array,
// or an Error to throw for that email.
export function fakeAgent({ emails = [], results = {}, fetchError } = {}) {
  const calls = { fetchEmails: [], summarize: [], validateProfile: [] };
  return {
    calls,
    health: async () => ({ status: 'ok' }),
    async fetchEmails(args) {
      calls.fetchEmails.push(args);
      if (fetchError) throw fetchError;
      return { provider: 'fake', emails };
    },
    async summarize(email, profile) {
      calls.summarize.push({ email, profile });
      const result = results[email.message_id] ?? [];
      if (result instanceof Error) throw result;
      return makeSummary(email, result);
    },
    async validateProfile(profile) {
      calls.validateProfile.push(profile);
      if (profile.invalid) throw agentError(422, 'weights.skills: must be >= 0');
      return { ...profile, normalised: true };
    },
  };
}

export function setup({ agent = fakeAgent(), config = TEST_CONFIG, profileFiles = [] } = {}) {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const profileStore = createProfileStore({ repo, files: profileFiles });
  const log = { info() {}, warn() {}, error() {} };
  const runner = createRunner({ repo, agent, getProfile: profileStore.get, config, log });
  const app = createApp({ agent, repo, runner, profileStore });
  return { db, repo, agent, runner, profileStore, app };
}

// Starts the app on a random free port.
export async function serve(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}
