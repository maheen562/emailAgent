import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agentError, fakeAgent, makeEmail, makeJob, setup } from './helpers.js';

const run = async (runner) => runner.start('manual').promise;

test('judges new emails and stores their jobs', async () => {
  const e1 = makeEmail(1);
  const e2 = makeEmail(2);
  const agent = fakeAgent({
    emails: [e2, e1],
    results: {
      [e1.message_id]: [makeJob(), makeJob({ title: 'Junior Dev', company: 'Tarbela' })],
      [e2.message_id]: [makeJob({ title: 'AI Intern', company: 'Koh Digital' })],
    },
  });
  const { runner, repo } = setup({ agent });

  const result = await run(runner);

  assert.equal(result.status, 'success');
  assert.equal(result.emails_fetched, 2);
  assert.equal(result.emails_new, 2);
  assert.equal(result.jobs_new, 3);
  assert.equal(result.input_tokens, 200);
  assert.equal(repo.listJobs().total, 3);
  // processed oldest first
  assert.deepEqual(agent.calls.summarize.map((c) => c.email.message_id), [e1.message_id, e2.message_id]);
});

test('passes a lookback window and limit to the agent', async () => {
  const agent = fakeAgent();
  const { runner } = setup({ agent, config: { lookbackDays: 7, fetchLimit: 10, summarizeDelayMs: 0, maxEmailAttempts: 3 } });
  await run(runner);
  const { since, limit } = agent.calls.fetchEmails[0];
  assert.equal(limit, 10);
  const days = (Date.now() - since.getTime()) / 86_400_000;
  assert.ok(days > 6.99 && days < 7.01);
});

test('never sends an already processed email to the LLM again', async () => {
  const e1 = makeEmail(1);
  const agent = fakeAgent({ emails: [e1], results: { [e1.message_id]: [makeJob()] } });
  const { runner } = setup({ agent });

  await run(runner);
  const second = await run(runner);

  assert.equal(agent.calls.summarize.length, 1);
  assert.equal(second.emails_new, 0);
  assert.equal(second.status, 'success');
});

test('counts the same job across emails as a duplicate', async () => {
  const e1 = makeEmail(1);
  const e2 = makeEmail(2, { source: 'indeed' });
  const agent = fakeAgent({
    emails: [e1, e2],
    results: { [e1.message_id]: [makeJob()], [e2.message_id]: [makeJob({ title: 'Python Intern (Remote)' })] },
  });
  const { runner, repo } = setup({ agent });

  const result = await run(runner);

  assert.equal(result.jobs_new, 1);
  assert.equal(result.jobs_duplicate, 1);
  assert.equal(repo.listJobs().jobs[0].seen_count, 2);
});

test('rate limit stops the run and leaves the rest for next time', async () => {
  const [e1, e2, e3] = [makeEmail(1), makeEmail(2), makeEmail(3)];
  const agent = fakeAgent({
    emails: [e1, e2, e3],
    results: { [e1.message_id]: [makeJob()], [e2.message_id]: agentError(429, 'Gemini rate limit') },
  });
  const { runner, repo } = setup({ agent });

  const result = await run(runner);

  assert.equal(result.status, 'stopped');
  assert.match(result.error, /rate limit.*2 email\(s\) left/);
  assert.equal(agent.calls.summarize.length, 2); // e3 never attempted
  assert.equal(repo.getEmail(e2.message_id), null); // not marked failed: it will be retried
});

test('a stopped run resumes on the next run', async () => {
  const [e1, e2] = [makeEmail(1), makeEmail(2)];
  const results = { [e1.message_id]: [makeJob()], [e2.message_id]: agentError(429) };
  const agent = fakeAgent({ emails: [e1, e2], results });
  const { runner, repo } = setup({ agent });

  await run(runner);
  results[e2.message_id] = [makeJob({ title: 'AI Intern' })]; // quota is back
  const next = await run(runner);

  assert.equal(next.status, 'success');
  assert.equal(next.emails_new, 1);
  assert.equal(repo.getEmail(e2.message_id).status, 'processed');
});

test('one bad email is recorded and the rest still get judged', async () => {
  const [e1, e2] = [makeEmail(1), makeEmail(2)];
  const agent = fakeAgent({
    emails: [e1, e2],
    results: { [e1.message_id]: agentError(502, 'invalid JSON twice'), [e2.message_id]: [makeJob()] },
  });
  const { runner, repo } = setup({ agent });

  const result = await run(runner);

  assert.equal(result.status, 'partial');
  assert.equal(result.emails_failed, 1);
  assert.equal(result.emails_new, 1);
  const failed = repo.getEmail(e1.message_id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /invalid JSON/);
});

test('a failing email is retried up to the attempt limit', async () => {
  const e1 = makeEmail(1);
  const agent = fakeAgent({ emails: [e1], results: { [e1.message_id]: agentError(502) } });
  const { runner, repo } = setup({ agent, config: { lookbackDays: 7, fetchLimit: 25, summarizeDelayMs: 0, maxEmailAttempts: 2 } });

  await run(runner);
  await run(runner);
  await run(runner);

  assert.equal(agent.calls.summarize.length, 2);
  assert.equal(repo.getEmail(e1.message_id).attempts, 2);
});

for (const [status, label] of [[503, 'setup problem'], [422, 'invalid profile'], [undefined, 'agent unreachable']]) {
  test(`${label} stops the run as failed`, async () => {
    const [e1, e2] = [makeEmail(1), makeEmail(2)];
    const agent = fakeAgent({ emails: [e1, e2], results: { [e1.message_id]: agentError(status, label) } });
    const { runner } = setup({ agent });

    const result = await run(runner);

    assert.equal(result.status, 'failed');
    assert.equal(result.error, label);
    assert.equal(agent.calls.summarize.length, 1);
  });
}

test('a failed fetch fails the run', async () => {
  const agent = fakeAgent({ fetchError: agentError(503, 'Gmail sign-in expired') });
  const { runner } = setup({ agent });
  const result = await run(runner);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Gmail sign-in expired/);
});

test('only one run at a time', async () => {
  const { runner } = setup();
  const first = runner.start('manual');
  assert.equal(runner.start('manual'), null);
  assert.equal(runner.currentRunId(), first.id);
  await first.promise;
  assert.equal(runner.isRunning(), false);
  assert.ok(runner.start('manual'));
});

test('waits between LLM calls to respect free-tier limits', async () => {
  const emails = [makeEmail(1), makeEmail(2), makeEmail(3)];
  const agent = fakeAgent({ emails });
  const slept = [];
  const { repo, profileStore } = setup({ agent });
  const { createRunner } = await import('../src/pipeline.js');
  const runner = createRunner({
    repo,
    agent,
    getProfile: profileStore.get,
    config: { lookbackDays: 7, fetchLimit: 25, summarizeDelayMs: 1500, maxEmailAttempts: 3 },
    sleep: async (ms) => slept.push(ms),
    log: {},
  });
  await runner.start().promise;
  assert.deepEqual(slept, [1500, 1500]); // between calls, not before the first
});

test('sends the current profile with each email', async () => {
  const e1 = makeEmail(1);
  const agent = fakeAgent({ emails: [e1] });
  const { runner, profileStore } = setup({ agent });
  profileStore.save({ locations: ['Islamabad'] });
  await run(runner);
  assert.deepEqual(agent.calls.summarize[0].profile, { locations: ['Islamabad'] });
});

test('progress is saved after each email while the run is going', async () => {
  const [e1, e2] = [makeEmail(1), makeEmail(2)];
  const agent = fakeAgent({ emails: [e1, e2], results: { [e1.message_id]: [makeJob()] } });
  const { runner, repo } = setup({ agent });
  let seenMidRun;
  const summarize = agent.summarize.bind(agent);
  agent.summarize = async (email, profile) => {
    if (email.message_id === e2.message_id) seenMidRun = repo.getRun(runner.currentRunId());
    return summarize(email, profile);
  };

  await runner.start('manual').promise;

  assert.equal(seenMidRun.status, 'running');
  assert.equal(seenMidRun.emails_fetched, 2);
  assert.equal(seenMidRun.emails_new, 1);
  assert.equal(seenMidRun.jobs_new, 1);
});
