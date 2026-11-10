// Every SQL query lives here, so routes and the pipeline never build SQL themselves.
import { dedupeKey } from './dedupe.js';
import { transaction } from './db.js';

export const JOB_STATUSES = ['new', 'saved', 'applied', 'ignored'];
export const VERDICTS = ['apply_now', 'worth_a_look', 'skip'];

const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? []);

function jobFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    work_mode: row.work_mode,
    employment_type: row.employment_type,
    experience_required: row.experience_required,
    salary: row.salary,
    hours: row.hours,
    summary: row.summary,
    apply_url: row.apply_url,
    deadline: row.deadline,
    overall_score: row.overall_score,
    verdict: row.verdict,
    why_it_matters: row.why_it_matters,
    factor_scores: JSON.parse(row.factor_scores_json),
    skills_matched: JSON.parse(row.skills_matched_json),
    skills_missing: JSON.parse(row.skills_missing_json),
    dealbreakers_hit: JSON.parse(row.dealbreakers_json),
    red_flags: JSON.parse(row.red_flags_json),
    status: row.status,
    seen_count: row.seen_count,
    first_message_id: row.first_message_id,
    source: row.source ?? null,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  };
}

function emailFromRow(row) {
  if (!row) return null;
  const { counts_json, ...rest } = row;
  return { ...rest, counts: counts_json ? JSON.parse(counts_json) : null };
}

const RUN_COUNTERS = [
  'emails_fetched',
  'emails_new',
  'emails_failed',
  'jobs_new',
  'jobs_duplicate',
  'input_tokens',
  'output_tokens',
];

export function createRepo(db) {
  const stmt = {
    insertRun: db.prepare(
      `INSERT INTO runs (trigger, status, started_at) VALUES (?, 'running', ?) RETURNING id`,
    ),
    getRun: db.prepare('SELECT * FROM runs WHERE id = ?'),
    listRuns: db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?'),
    getEmail: db.prepare('SELECT * FROM emails WHERE message_id = ?'),
    upsertEmail: db.prepare(`
      INSERT INTO emails (message_id, source, sender, subject, received_at, status, attempts, error,
                          job_count, counts_json, one_line_summary, run_id, processed_at)
      VALUES (:message_id, :source, :sender, :subject, :received_at, :status, :attempts, :error,
              :job_count, :counts_json, :one_line_summary, :run_id, :processed_at)
      ON CONFLICT (message_id) DO UPDATE SET
        status = excluded.status, attempts = excluded.attempts, error = excluded.error,
        job_count = excluded.job_count, counts_json = excluded.counts_json,
        one_line_summary = excluded.one_line_summary, run_id = excluded.run_id,
        processed_at = excluded.processed_at`),
    listEmails: db.prepare('SELECT * FROM emails ORDER BY received_at DESC LIMIT ? OFFSET ?'),
    countEmails: db.prepare('SELECT count(*) AS n FROM emails'),
    insertJob: db.prepare(`
      INSERT INTO jobs (dedupe_key, first_message_id, title, company, location, work_mode,
        employment_type, experience_required, salary, hours, summary, apply_url, deadline,
        overall_score, verdict, why_it_matters, factor_scores_json, skills_matched_json,
        skills_missing_json, dealbreakers_json, red_flags_json, created_at, last_seen_at, updated_at)
      VALUES (:dedupe_key, :first_message_id, :title, :company, :location, :work_mode,
        :employment_type, :experience_required, :salary, :hours, :summary, :apply_url, :deadline,
        :overall_score, :verdict, :why_it_matters, :factor_scores_json, :skills_matched_json,
        :skills_missing_json, :dealbreakers_json, :red_flags_json, :now, :now, :now)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`),
    markJobSeenAgain: db.prepare(`
      UPDATE jobs SET seen_count = seen_count + 1, last_seen_at = :now,
        apply_url = COALESCE(apply_url, :apply_url)
      WHERE dedupe_key = :dedupe_key`),
    getJob: db.prepare(`
      SELECT jobs.*, emails.source FROM jobs
      LEFT JOIN emails ON emails.message_id = jobs.first_message_id
      WHERE jobs.id = ?`),
    setJobStatus: db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ),
  };

  return {
    // --- runs ------------------------------------------------------------
    startRun(trigger) {
      return stmt.insertRun.get(trigger, now()).id;
    },

    finishRun(id, { status, error = null, ...counters }) {
      const sets = RUN_COUNTERS.filter((c) => c in counters);
      db.prepare(
        `UPDATE runs SET status = ?, error = ?, finished_at = ?${sets.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`,
      ).run(status, error, now(), ...sets.map((c) => counters[c]), id);
    },

    // Saves the counters so far while a run is still going, so progress is visible.
    updateRunProgress(id, counters) {
      const sets = RUN_COUNTERS.filter((c) => c in counters);
      if (!sets.length) return;
      db.prepare(`UPDATE runs SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
        ...sets.map((c) => counters[c]),
        id,
      );
    },

    getRun(id) {
      const row = stmt.getRun.get(id);
      return row ? { ...row } : null;
    },
    listRuns: (limit = 20) => stmt.listRuns.all(limit).map((r) => ({ ...r })),

    // A run left as "running" by a crash or restart can never finish; close it.
    closeAbandonedRuns() {
      db.prepare(
        `UPDATE runs SET status = 'failed', error = 'Interrupted (server restarted)', finished_at = ?
         WHERE status = 'running'`,
      ).run(now());
    },

    // --- emails ----------------------------------------------------------
    getEmail: (messageId) => emailFromRow(stmt.getEmail.get(messageId)),

    listEmails({ limit = 50, offset = 0 } = {}) {
      return {
        emails: stmt.listEmails.all(limit, offset).map(emailFromRow),
        total: stmt.countEmails.get().n,
      };
    },

    recordEmailFailure(email, { runId, error }) {
      const attempts = (stmt.getEmail.get(email.message_id)?.attempts ?? 0) + 1;
      stmt.upsertEmail.run({
        ...emailFields(email),
        status: 'failed',
        attempts,
        error,
        job_count: null,
        counts_json: null,
        one_line_summary: null,
        run_id: runId,
        processed_at: now(),
      });
      return attempts;
    },

    // Saves the email and its jobs in one transaction. Returns how many jobs
    // were new and how many were duplicates of jobs already stored.
    saveSummary(email, summary, { runId }) {
      return transaction(db, () => {
        const attempts = (stmt.getEmail.get(email.message_id)?.attempts ?? 0) + 1;
        stmt.upsertEmail.run({
          ...emailFields(email),
          status: 'processed',
          attempts,
          error: null,
          job_count: summary.job_count,
          counts_json: JSON.stringify(summary.counts),
          one_line_summary: summary.one_line_summary,
          run_id: runId,
          processed_at: now(),
        });

        let created = 0;
        let duplicates = 0;
        for (const job of summary.jobs) {
          const key = dedupeKey(job);
          const inserted = stmt.insertJob.get({
            dedupe_key: key,
            first_message_id: email.message_id,
            title: job.title,
            company: job.company ?? null,
            location: job.location ?? null,
            work_mode: job.work_mode,
            employment_type: job.employment_type,
            experience_required: job.experience_required ?? null,
            salary: job.salary ?? null,
            hours: job.hours ?? null,
            summary: job.summary,
            apply_url: job.apply_url ?? null,
            deadline: job.deadline ?? null,
            overall_score: job.overall_score,
            verdict: job.verdict,
            why_it_matters: job.why_it_matters,
            factor_scores_json: JSON.stringify(job.factor_scores),
            skills_matched_json: json(job.skills_matched),
            skills_missing_json: json(job.skills_missing),
            dealbreakers_json: json(job.dealbreakers_hit),
            red_flags_json: json(job.red_flags),
            now: now(),
          });
          if (inserted) {
            created += 1;
          } else {
            stmt.markJobSeenAgain.run({ dedupe_key: key, now: now(), apply_url: job.apply_url ?? null });
            duplicates += 1;
          }
        }
        return { created, duplicates };
      });
    },

    // --- jobs ------------------------------------------------------------
    listJobs({ verdict, status, minScore, q, sort = 'score', limit = 50, offset = 0 } = {}) {
      const where = [];
      const params = [];
      if (verdict) {
        where.push('jobs.verdict = ?');
        params.push(verdict);
      }
      if (status) {
        where.push('jobs.status = ?');
        params.push(status);
      }
      if (minScore !== undefined) {
        where.push('jobs.overall_score >= ?');
        params.push(minScore);
      }
      if (q) {
        where.push(
          "(jobs.title LIKE ? ESCAPE '\\' OR jobs.company LIKE ? ESCAPE '\\' OR jobs.location LIKE ? ESCAPE '\\')",
        );
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        params.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const orderSql =
        sort === 'newest' ? 'jobs.last_seen_at DESC, jobs.id DESC' : 'jobs.overall_score DESC, jobs.id DESC';

      const rows = db
        .prepare(
          `SELECT jobs.*, emails.source FROM jobs
           LEFT JOIN emails ON emails.message_id = jobs.first_message_id
           ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      const { n } = db.prepare(`SELECT count(*) AS n FROM jobs ${whereSql}`).get(...params);
      return { jobs: rows.map(jobFromRow), total: n };
    },

    getJob: (id) => jobFromRow(stmt.getJob.get(id)),

    setJobStatus(id, status) {
      const { changes } = stmt.setJobStatus.run(status, now(), id);
      return changes > 0 ? jobFromRow(stmt.getJob.get(id)) : null;
    },

    // --- settings --------------------------------------------------------
    getSetting(key) {
      const row = stmt.getSetting.get(key);
      return row ? JSON.parse(row.value) : null;
    },

    setSetting(key, value) {
      stmt.setSetting.run(key, JSON.stringify(value));
    },
  };
}

function emailFields(email) {
  return {
    message_id: email.message_id,
    source: email.source,
    sender: email.sender,
    subject: email.subject,
    received_at: email.received_at,
  };
}
