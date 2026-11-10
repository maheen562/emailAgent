import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeEmail, makeJob, makeSummary, setup } from './helpers.js';

function seed(repo) {
  const runId = repo.startRun('manual');
  const email = makeEmail(1);
  repo.saveSummary(
    email,
    makeSummary(email, [
      makeJob({ title: 'Python Intern', overall_score: 95, verdict: 'apply_now' }),
      makeJob({ title: 'Junior Dev', company: 'Tarbela Tech', overall_score: 65, verdict: 'worth_a_look' }),
      makeJob({ title: 'Senior Engineer', company: 'Crestline', overall_score: 20, verdict: 'skip', location: 'Lahore' }),
    ]),
    { runId },
  );
  return { runId, email };
}

test('saveSummary stores the email and its jobs', () => {
  const { repo } = setup();
  const { email } = seed(repo);
  const stored = repo.getEmail(email.message_id);
  assert.equal(stored.status, 'processed');
  assert.equal(stored.job_count, 3);
  assert.deepEqual(stored.counts, { apply_now: 1, worth_a_look: 1, skip: 1 });
  assert.equal(repo.listJobs().total, 3);
});

test('a job seen again in another email is stored once and counted', () => {
  const { repo } = setup();
  seed(repo);
  const second = makeEmail(2, { source: 'indeed' });
  const result = repo.saveSummary(
    second,
    makeSummary(second, [makeJob({ title: 'python intern (Remote)', company: 'Nimbus Labs Ltd' })]),
    { runId: repo.startRun('manual') },
  );
  assert.deepEqual(result, { created: 0, duplicates: 1 });
  const { jobs, total } = repo.listJobs({ q: 'Python' });
  assert.equal(total, 1);
  assert.equal(jobs[0].seen_count, 2);
  assert.equal(jobs[0].source, 'linkedin'); // where it was first seen
});

test('a duplicate keeps the status I already set', () => {
  const { repo } = setup();
  seed(repo);
  const [job] = repo.listJobs({ q: 'Python' }).jobs;
  repo.setJobStatus(job.id, 'applied');
  const again = makeEmail(2);
  repo.saveSummary(again, makeSummary(again, [makeJob()]), { runId: repo.startRun('manual') });
  assert.equal(repo.getJob(job.id).status, 'applied');
});

test('listJobs filters, searches and sorts', () => {
  const { repo } = setup();
  seed(repo);
  assert.deepEqual(repo.listJobs().jobs.map((j) => j.overall_score), [95, 65, 20]);
  assert.equal(repo.listJobs({ verdict: 'skip' }).jobs[0].title, 'Senior Engineer');
  assert.equal(repo.listJobs({ minScore: 60 }).total, 2);
  assert.equal(repo.listJobs({ q: 'lahore' }).jobs[0].company, 'Crestline');
  assert.equal(repo.listJobs({ limit: 1, offset: 1 }).jobs[0].title, 'Junior Dev');
  assert.equal(repo.listJobs({ limit: 1 }).total, 3);
});

test('search treats % and _ literally', () => {
  const { repo } = setup();
  seed(repo);
  assert.equal(repo.listJobs({ q: '%' }).total, 0);
});

test('jobs come back with parsed JSON fields', () => {
  const { repo } = setup();
  seed(repo);
  const job = repo.listJobs().jobs[0];
  assert.equal(job.factor_scores.skills.score, 8);
  assert.deepEqual(job.skills_matched, ['Python']);
  assert.equal(job.status, 'new');
});

test('recordEmailFailure counts attempts', () => {
  const { repo } = setup();
  const email = makeEmail(1);
  const runId = repo.startRun('manual');
  assert.equal(repo.recordEmailFailure(email, { runId, error: 'bad json' }), 1);
  assert.equal(repo.recordEmailFailure(email, { runId, error: 'bad json' }), 2);
  assert.equal(repo.getEmail(email.message_id).status, 'failed');
});

test('saveSummary is all-or-nothing', () => {
  const { repo } = setup();
  const email = makeEmail(1);
  const broken = makeJob({ title: null }); // violates NOT NULL
  assert.throws(() =>
    repo.saveSummary(email, makeSummary(email, [makeJob(), broken]), { runId: repo.startRun('manual') }),
  );
  assert.equal(repo.getEmail(email.message_id), null);
  assert.equal(repo.listJobs().total, 0);
});

test('closeAbandonedRuns fails runs left running by a restart', () => {
  const { repo } = setup();
  const id = repo.startRun('schedule');
  repo.closeAbandonedRuns();
  const run = repo.getRun(id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /restarted/);
});
