import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fakeAgent, makeEmail, makeJob, makeSummary, serve, setup } from './helpers.js';

async function withServer(options, fn) {
  const ctx = setup(options);
  const server = await serve(ctx.app);
  try {
    await fn({ ...ctx, call: server.call });
  } finally {
    await server.close();
  }
}

function seedJobs(repo) {
  const email = makeEmail(1);
  repo.saveSummary(
    email,
    makeSummary(email, [
      makeJob({ title: 'Python Intern', overall_score: 95, verdict: 'apply_now' }),
      makeJob({ title: 'Senior Dev', company: 'Crestline', overall_score: 20, verdict: 'skip' }),
    ]),
    { runId: repo.startRun('manual') },
  );
}

test('GET /api/jobs lists and filters jobs', () =>
  withServer({}, async ({ repo, call }) => {
    seedJobs(repo);
    const all = await call('GET', '/api/jobs');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);
    assert.equal(all.body.jobs[0].title, 'Python Intern');

    const skip = await call('GET', '/api/jobs?verdict=skip');
    assert.deepEqual(skip.body.jobs.map((j) => j.title), ['Senior Dev']);
  }));

test('GET /api/jobs rejects bad query values', () =>
  withServer({}, async ({ call }) => {
    assert.equal((await call('GET', '/api/jobs?verdict=maybe')).status, 400);
    assert.equal((await call('GET', '/api/jobs?minScore=101')).status, 400);
    const bad = await call('GET', '/api/jobs?limit=abc');
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /limit/);
  }));

test('PATCH /api/jobs/:id updates the status', () =>
  withServer({}, async ({ repo, call }) => {
    seedJobs(repo);
    const [job] = repo.listJobs().jobs;
    const res = await call('PATCH', `/api/jobs/${job.id}`, { status: 'applied' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'applied');
    assert.equal((await call('GET', '/api/jobs?status=applied')).body.total, 1);
  }));

test('PATCH /api/jobs/:id validates input', () =>
  withServer({}, async ({ repo, call }) => {
    seedJobs(repo);
    assert.equal((await call('PATCH', '/api/jobs/1', { status: 'hired' })).status, 400);
    assert.equal((await call('PATCH', '/api/jobs/1', {})).status, 400);
    assert.equal((await call('PATCH', '/api/jobs/999', { status: 'saved' })).status, 404);
    assert.equal((await call('GET', '/api/jobs/999')).status, 404);
  }));

test('GET /api/emails shows the inbox view', () =>
  withServer({}, async ({ repo, call }) => {
    seedJobs(repo);
    const res = await call('GET', '/api/emails');
    assert.equal(res.body.total, 1);
    assert.equal(res.body.emails[0].one_line_summary, '2 jobs');
    assert.deepEqual(res.body.emails[0].counts, { apply_now: 1, worth_a_look: 0, skip: 1 });
  }));

test('POST /api/runs starts a run and returns 202; a second is rejected with 409', () => {
  const e1 = makeEmail(1);
  const agent = fakeAgent({ emails: [e1], results: { [e1.message_id]: [makeJob()] } });
  // Hold the run open until the test has made its second request.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const summarize = agent.summarize.bind(agent);
  agent.summarize = async (...args) => {
    await gate;
    return summarize(...args);
  };

  return withServer({ agent }, async ({ runner, call }) => {
    const first = await call('POST', '/api/runs');
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'running');
    assert.equal(first.headers.get('location'), `/api/runs/${first.body.id}`);

    const second = await call('POST', '/api/runs');
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already in progress/);
    release();

    // wait for the background run to finish, then check it via the API
    while (runner.isRunning()) await new Promise((r) => setTimeout(r, 5));
    const done = await call('GET', `/api/runs/${first.body.id}`);
    assert.equal(done.body.status, 'success');
    assert.equal(done.body.jobs_new, 1);

    const history = await call('GET', '/api/runs');
    assert.equal(history.body.runs.length, 1);
    assert.equal(history.body.running, false);
  });
});

test('GET /api/runs/:id returns 404 for an unknown run', () =>
  withServer({}, async ({ call }) => {
    assert.equal((await call('GET', '/api/runs/42')).status, 404);
  }));

test('GET /api/profile falls back to the profile file, PUT validates and saves', () =>
  withServer({}, async ({ agent, call }) => {
    assert.deepEqual((await call('GET', '/api/profile')).body, {}); // no files in tests

    const saved = await call('PUT', '/api/profile', { locations: ['Islamabad'] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.normalised, true); // stored what the agent returned
    assert.deepEqual(agent.calls.validateProfile[0], { locations: ['Islamabad'] });
    assert.equal((await call('GET', '/api/profile')).body.normalised, true);
  }));

test('PUT /api/profile rejects invalid profiles without saving', () =>
  withServer({}, async ({ call }) => {
    const res = await call('PUT', '/api/profile', { invalid: true });
    assert.equal(res.status, 422);
    assert.match(res.body.error, /weights\.skills/);
    assert.deepEqual((await call('GET', '/api/profile')).body, {});

    assert.equal((await call('PUT', '/api/profile', [1, 2])).status, 400);
  }));
