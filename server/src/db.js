// SQLite storage using Node's built-in node:sqlite (no native build step).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY,
  trigger         TEXT NOT NULL,                  -- manual | schedule
  status          TEXT NOT NULL,                  -- running | success | partial | stopped | failed
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  emails_fetched  INTEGER NOT NULL DEFAULT 0,
  emails_new      INTEGER NOT NULL DEFAULT 0,
  emails_failed   INTEGER NOT NULL DEFAULT 0,
  jobs_new        INTEGER NOT NULL DEFAULT 0,
  jobs_duplicate  INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

-- One row per alert email. Its status decides whether a later run retries it.
CREATE TABLE IF NOT EXISTS emails (
  message_id       TEXT PRIMARY KEY,
  source           TEXT NOT NULL,
  sender           TEXT NOT NULL,
  subject          TEXT NOT NULL,
  received_at      TEXT NOT NULL,
  status           TEXT NOT NULL,                 -- processed | failed
  attempts         INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  job_count        INTEGER,
  counts_json      TEXT,
  one_line_summary TEXT,
  run_id           INTEGER REFERENCES runs(id),
  processed_at     TEXT
);

-- One row per distinct job, even if it appeared in several alerts.
CREATE TABLE IF NOT EXISTS jobs (
  id                  INTEGER PRIMARY KEY,
  dedupe_key          TEXT NOT NULL UNIQUE,
  first_message_id    TEXT NOT NULL REFERENCES emails(message_id),
  title               TEXT NOT NULL,
  company             TEXT,
  location            TEXT,
  work_mode           TEXT NOT NULL,
  employment_type     TEXT NOT NULL,
  experience_required TEXT,
  salary              TEXT,
  hours               TEXT,
  summary             TEXT NOT NULL,
  apply_url           TEXT,
  deadline            TEXT,
  overall_score       INTEGER NOT NULL,
  verdict             TEXT NOT NULL,              -- apply_now | worth_a_look | skip
  why_it_matters      TEXT NOT NULL,
  factor_scores_json  TEXT NOT NULL,
  skills_matched_json TEXT NOT NULL,
  skills_missing_json TEXT NOT NULL,
  dealbreakers_json   TEXT NOT NULL,
  red_flags_json      TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'new', -- new | saved | applied | ignored
  seen_count          INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_verdict_score ON jobs (verdict, overall_score DESC);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS emails_received ON emails (received_at DESC);

-- Small key/value store (holds the profile).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Opens (and creates if needed) the database. Use ':memory:' in tests.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;'); // reads don't block the run's writes
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside a transaction: all of its writes are saved, or none are.
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
