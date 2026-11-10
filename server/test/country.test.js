import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalCountry, guessCountry, resolveCountry } from '../src/country.js';
import { openDb } from '../src/db.js';
import { createRepo } from '../src/repo.js';
import { makeEmail, makeJob, makeSummary, serve, setup } from './helpers.js';

test('guessCountry recognises Pakistani and Australian places', () => {
  assert.equal(guessCountry('Islamabad, Pakistan (Remote)'), 'Pakistan');
  assert.equal(guessCountry('Lahore'), 'Pakistan');
  assert.equal(guessCountry('Melbourne, VIC'), 'Australia');
  assert.equal(guessCountry('Mulgrave, VIC'), 'Australia');
  assert.equal(guessCountry('Gold Coast QLD'), 'Australia');
  assert.equal(guessCountry('Remote'), null);
  assert.equal(guessCountry(null), null);
});

test('guessCountry matches whole words only', () => {
  assert.equal(guessCountry('Victoria Park, London'), null); // "vic" inside "Victoria" must not match
  assert.equal(guessCountry('Factory floor'), null); // "act" inside a word must not match
});

test('canonicalCountry normalises names', () => {
  assert.equal(canonicalCountry(' pakistan '), 'Pakistan');
  assert.equal(canonicalCountry('PK'), 'Pakistan');
  assert.equal(canonicalCountry('anywhere'), 'Worldwide');
  assert.equal(canonicalCountry('united arab emirates'), 'United Arab Emirates');
  assert.equal(canonicalCountry('unknown'), null);
  assert.equal(canonicalCountry(null), null);
});

test("resolveCountry prefers the model's answer and falls back to the location", () => {
  assert.equal(resolveCountry({ country: 'Australia', location: 'Lahore' }), 'Australia');
  assert.equal(resolveCountry({ country: null, location: 'Karachi' }), 'Pakistan');
  assert.equal(resolveCountry({ location: 'Remote' }), null);
});

function seedWorld(repo) {
  const email = makeEmail(1);
  repo.saveSummary(
    email,
    makeSummary(email, [
      makeJob({ title: 'Python Intern', location: 'Islamabad', country: 'Pakistan' }),
      makeJob({ title: 'QA Engineer', company: 'Acme AU', location: 'Melbourne, VIC', country: null }),
      makeJob({ title: 'Remote Dev', company: 'Global Co', location: 'Remote', country: 'Worldwide' }),
      makeJob({ title: 'Mystery Role', company: 'Unknown Co', location: 'Remote', country: null }),
    ]),
    { runId: repo.startRun('manual') },
  );
}

test('listJobs filters by country, optionally including worldwide remote jobs', () => {
  const { repo } = setup();
  seedWorld(repo);
  assert.deepEqual(repo.listJobs({ country: 'Pakistan' }).jobs.map((j) => j.title), ['Python Intern']);
  assert.deepEqual(
    repo.listJobs({ country: 'pakistan', withWorldwide: true }).jobs.map((j) => j.title).sort(),
    ['Python Intern', 'Remote Dev'],
  );
  assert.equal(repo.listJobs({ country: 'Australia' }).jobs[0].title, 'QA Engineer'); // guessed from "VIC"
  assert.equal(repo.listJobs().total, 4);
});

test('GET /api/jobs supports country and worldwide parameters', async () => {
  const { repo, app } = setup();
  seedWorld(repo);
  const server = await serve(app);
  try {
    assert.equal((await server.call('GET', '/api/jobs?country=Pakistan')).body.total, 1);
    assert.equal((await server.call('GET', '/api/jobs?country=Pakistan&worldwide=1')).body.total, 2);
    assert.equal((await server.call('GET', '/api/jobs?worldwide=yes')).status, 400);
  } finally {
    await server.close();
  }
});

test('opening an older database adds the country column and fills it in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-migrate-'));
  const file = path.join(dir, 'old.db');
  try {
    // Build a database the way the previous version did: no country column.
    const oldDb = openDb(file);
    const repo = createRepo(oldDb);
    const email = makeEmail(1);
    repo.saveSummary(email, makeSummary(email, [makeJob({ location: 'Melbourne, VIC' })]), {
      runId: repo.startRun('manual'),
    });
    oldDb.exec('DROP INDEX jobs_country; ALTER TABLE jobs DROP COLUMN country;');
    oldDb.close();

    const newDb = openDb(file);
    assert.equal(createRepo(newDb).listJobs().jobs[0].country, 'Australia');
    newDb.close(); // Windows can't delete an open database file
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
