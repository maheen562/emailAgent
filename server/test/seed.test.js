import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { seed } from '../scripts/seed.js';
import { setup } from './helpers.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/demo-results.json', import.meta.url), 'utf8'));

test('the fixture loads through the same code path as a real run', () => {
  const { repo } = setup();
  const totals = seed(repo, fixture);
  assert.equal(totals.emails_new, 4);
  assert.equal(totals.jobs_new, 11);
  assert.equal(repo.listJobs().total, 11);
  assert.equal(repo.listRuns()[0].trigger, 'seed');
});

test('seeding twice adds nothing new', () => {
  const { repo } = setup();
  seed(repo, fixture);
  assert.deepEqual(
    { emails: seed(repo, fixture).emails_new, jobs: repo.listJobs().total },
    { emails: 0, jobs: 11 },
  );
});

test('--reset clears jobs but keeps the profile', () => {
  const { repo, db } = setup();
  seed(repo, fixture);
  repo.setSetting('profile', { locations: ['Islamabad'] });
  repo.setJobStatus(repo.listJobs().jobs[0].id, 'applied');
  seed(repo, fixture, { reset: true, db });
  assert.equal(repo.listJobs({ status: 'applied' }).total, 0);
  assert.deepEqual(repo.getSetting('profile'), { locations: ['Islamabad'] });
});

test('the fixture covers every verdict', () => {
  const verdicts = new Set(fixture.results.flatMap((r) => r.summary.jobs.map((j) => j.verdict)));
  assert.deepEqual([...verdicts].sort(), ['apply_now', 'skip', 'worth_a_look']);
});
