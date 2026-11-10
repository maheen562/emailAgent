// Load the demo results into the database, so the dashboard can be explored
// without Gmail or a Gemini key.
//
//   npm run seed            add the demo emails and jobs (skips ones already there)
//   npm run seed -- --reset clear emails, jobs and runs first (keeps the profile)
//
// The fixture is real Gemini output for the fictional emails in agent/samples.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createRepo } from '../src/repo.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'demo-results.json');

export function seed(repo, fixture, { reset = false, db } = {}) {
  if (reset) db.exec('DELETE FROM jobs; DELETE FROM emails; DELETE FROM runs;');

  const runId = repo.startRun('seed');
  const totals = { emails_fetched: fixture.results.length, emails_new: 0, jobs_new: 0, jobs_duplicate: 0 };
  for (const { email, summary } of fixture.results) {
    if (repo.getEmail(email.message_id)) continue;
    const { created, duplicates } = repo.saveSummary(email, summary, { runId });
    totals.emails_new += 1;
    totals.jobs_new += created;
    totals.jobs_duplicate += duplicates;
  }
  repo.finishRun(runId, { status: 'success', ...totals });
  return totals;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = loadConfig();
  const db = openDb(config.dbFile);
  const totals = seed(createRepo(db), JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), {
    reset: process.argv.includes('--reset'),
    db,
  });
  db.close();
  console.log(`Seeded ${config.dbFile}: ${totals.emails_new} new emails, ${totals.jobs_new} new jobs.`);
}
